"""Orders CRUD (list, create) scoped to active company."""

import json
import secrets
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from app.core.database import get_db
from app.dependencies.auth import effective_company_id, require_permissions
from app.domains.user.models.users import Users
from app.domains.business_lookups.services.blinds_catalog import (
    load_allowed_category_ids_by_type,
    normalize_blinds_line_category_value,
    validate_blinds_lines_categories,
)


router = APIRouter(prefix="/orders", tags=["Orders"])


def _company_tax_rate_percent(db: Session, company_id: UUID) -> Decimal | None:
    row = db.execute(
        text(
            "SELECT tax_rate_percent FROM companies WHERE id = CAST(:cid AS uuid) LIMIT 1"
        ),
        {"cid": str(company_id)},
    ).mappings().first()
    if not row or row["tax_rate_percent"] is None:
        return None
    return Decimal(str(row["tax_rate_percent"]))


def _tax_amount_from_base(tax_base: Decimal | None, rate_pct: Decimal | None) -> Decimal | None:
    """Order tax from taxable base and company default rate (%)."""
    if tax_base is None or rate_pct is None:
        return None
    if tax_base <= 0 or rate_pct <= 0:
        return Decimal("0.00")
    q = Decimal("0.01")
    return (tax_base * rate_pct / Decimal("100")).quantize(q, rounding=ROUND_HALF_UP)


def _balance_with_tax(
    total: Decimal | None,
    down: Decimal | None,
    tax_amt: Decimal | None,
) -> Decimal | None:
    """Amount owed: total − down payment + tax (tax optional)."""
    if total is None or down is None:
        return None
    t = Decimal(str(total))
    d = Decimal(str(down))
    tax_part = Decimal("0") if tax_amt is None else Decimal(str(tax_amt))
    return t - d + tax_part


def _new_order_id() -> str:
    return secrets.token_hex(8)

def _new_row_id() -> str:
    return secrets.token_hex(8)


_SQL_BLINDS_SUMMARY = """
COALESCE(
  (
    SELECT string_agg(
      CASE
        WHEN eb.perde_sayisi IS NOT NULL THEN bt.name || ' (' || eb.perde_sayisi::text || ')'
        ELSE bt.name
      END,
      ', ' ORDER BY eb.sort_order, bt.name
    )
    FROM estimate_blinds eb
    JOIN blinds_type bt ON bt.company_id = eb.company_id AND bt.id = eb.blinds_id
    WHERE eb.company_id = e.company_id AND eb.estimate_id = e.id
  ),
  (
    SELECT CASE
      WHEN e.perde_sayisi IS NOT NULL THEN bt.name || ' (' || e.perde_sayisi::text || ')'
      ELSE bt.name
    END
    FROM blinds_type bt
    WHERE bt.company_id = e.company_id AND bt.id = e.blinds_id
    LIMIT 1
  )
)
"""

_SQL_BLINDS_LINES_JSON = """
COALESCE(
  (
    SELECT json_agg(
      json_build_object(
        'id', bt.id,
        'name', bt.name,
        'window_count', eb.perde_sayisi
      )
      ORDER BY eb.sort_order, bt.name
    )
    FROM estimate_blinds eb
    JOIN blinds_type bt ON bt.company_id = eb.company_id AND bt.id = eb.blinds_id
    WHERE eb.company_id = e.company_id AND eb.estimate_id = e.id
  ),
  (
    SELECT json_agg(
      json_build_object(
        'id', bt2.id,
        'name', bt2.name,
        'window_count', e.perde_sayisi
      )
    )
    FROM blinds_type bt2
    WHERE bt2.company_id = e.company_id AND bt2.id = e.blinds_id
  ),
  '[]'::json
)
"""


def _normalize_line_note(raw: Any, *, max_len: int = 2000) -> str | None:
    if raw is None:
        return None
    s = str(raw).replace("\r\n", "\n").replace("\r", "\n").strip()
    if not s:
        return None
    return s[:max_len]


def _normalize_line_amount_to_float(raw: Any) -> float:
    """Non-negative monetary amount per blinds line; empty → 0."""
    if raw is None:
        return 0.0
    if isinstance(raw, (int, float)) and not isinstance(raw, bool):
        d = Decimal(str(raw))
    else:
        t = str(raw).strip().replace(",", ".")
        if not t:
            return 0.0
        try:
            d = Decimal(t)
        except Exception as exc:
            raise HTTPException(status_code=400, detail="Invalid line amount.") from exc
    if d < 0:
        raise HTTPException(status_code=400, detail="Line amounts cannot be negative.")
    q = d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return float(q)


def _normalize_blinds_lines(raw: Any) -> list[dict[str, Any]]:
    if raw is None:
        return []
    if isinstance(raw, list):
        out: list[dict[str, Any]] = []
        for x in raw:
            if not isinstance(x, dict):
                continue
            _id = x.get("id")
            name = x.get("name")
            if not _id or not name:
                continue
            cat = normalize_blinds_line_category_value(x.get("category"))
            row: dict[str, Any] = {
                "id": str(_id),
                "name": str(name),
                "window_count": x.get("window_count"),
                "category": cat,
                "line_note": _normalize_line_note(x.get("line_note")),
                "line_amount": _normalize_line_amount_to_float(x.get("line_amount")),
            }
            out.append(row)
        return out
    return []


def _sum_blinds_line_amounts(lines: list[dict[str, Any]]) -> Decimal:
    s = Decimal(0)
    for ln in lines:
        raw = ln.get("line_amount")
        if raw is None:
            continue
        try:
            s += Decimal(str(raw)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        except Exception:
            continue
    return s.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _normalize_order_note(raw: str | None, max_len: int = 4000) -> str | None:
    if raw is None:
        return None
    s = str(raw).replace("\r\n", "\n").replace("\r", "\n").strip()
    if not s:
        return None
    return s[:max_len]


def _ensure_default_order_status_id(db: Session, *, company_id: UUID) -> str | None:
    """Default label: 'New order' (status_order). Creates it if missing."""
    row = db.execute(
        text(
            """
            SELECT id
            FROM status_order
            WHERE company_id = CAST(:cid AS uuid) AND active IS TRUE AND lower(name) = 'new order'
            LIMIT 1
            """
        ),
        {"cid": str(company_id)},
    ).mappings().first()
    if row:
        return str(row["id"])
    new_id = _new_row_id()
    try:
        db.execute(
            text(
                """
                INSERT INTO status_order (company_id, id, name, active)
                VALUES (CAST(:cid AS uuid), :id, 'New order', TRUE)
                """
            ),
            {"cid": str(company_id), "id": new_id},
        )
        db.commit()
        return new_id
    except IntegrityError:
        db.rollback()
        row2 = db.execute(
            text(
                """
                SELECT id
                FROM status_order
                WHERE company_id = CAST(:cid AS uuid) AND active IS TRUE AND lower(name) = 'new order'
                LIMIT 1
                """
            ),
            {"cid": str(company_id)},
        ).mappings().first()
        return str(row2["id"]) if row2 else None


class OrderPrefillOut(BaseModel):
    estimate_id: str
    customer_id: str
    customer_display: str
    visit_notes: str | None = None
    blinds_summary: str | None = None
    blinds_lines: list[dict[str, Any]] = Field(default_factory=list)
    schedule_summary: str | None = None
    estimate_status: str
    company_tax_rate_percent: Decimal | None = None


class OrderListItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: UUID
    customer_id: str
    customer_display: str
    estimate_id: str | None = None
    total_amount: Decimal | None = None
    downpayment: Decimal | None = None
    balance: Decimal | None = None
    tax_uygulanacak_miktar: Decimal | None = None
    tax_amount: Decimal | None = None
    status_code: str
    status_order_label: str | None = None
    agreement_date: date | None = None
    created_at: Any | None = None
    active: bool = True


class OrderCreateIn(BaseModel):
    customer_id: str = Field(min_length=1, max_length=16)
    estimate_id: str | None = Field(None, max_length=16)
    tax_uygulanacak_miktar: Decimal | None = None
    total_amount: Decimal | None = None
    downpayment: Decimal | None = None
    agreement_date: date | None = None
    # agree_data is assigned later when status moves to in_production
    blinds_lines: list[dict[str, Any]] = Field(default_factory=list)
    order_note: str | None = Field(None, max_length=4000)


class OrderDetailOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: UUID
    customer_id: str
    customer_display: str
    estimate_id: str | None = None
    total_amount: Decimal | None = None
    downpayment: Decimal | None = None
    final_payment: Decimal | None = None
    balance: Decimal | None = None
    tax_uygulanacak_miktar: Decimal | None = None
    tax_amount: Decimal | None = None
    blinds_lines: list[dict[str, Any]] = Field(default_factory=list)
    order_note: str | None = None
    agree_data: str | None = None
    agreement_date: date | None = None
    status_code: str
    status_orde_id: str | None = None
    status_order_label: str | None = None
    created_at: Any | None = None
    updated_at: Any | None = None
    active: bool = True


class OrderPatchIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    status_code: str | None = None
    status_orde_id: str | None = None
    customer_id: str | None = Field(None, max_length=16)
    tax_uygulanacak_miktar: Decimal | None = None
    total_amount: Decimal | None = None
    downpayment: Decimal | None = None
    agreement_date: date | None = None
    order_note: str | None = Field(None, max_length=4000)
    blinds_lines: list[dict[str, Any]] | None = None


class OrderStatusLookupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str


class BlindsOrderTypeOpt(BaseModel):
    id: str
    name: str


class BlindsOrderCategoryOpt(BaseModel):
    id: str
    name: str
    sort_order: int


class BlindsLineAttributeRowOut(BaseModel):
    """One selectable row on the order form (category + extra kinds)."""

    kind_id: str
    label: str
    json_key: str
    sort_order: int
    options: list[BlindsOrderCategoryOpt]
    allowed_option_ids_by_blinds_type: dict[str, list[str]]


class BlindsOrderOptionsOut(BaseModel):
    blinds_types: list[BlindsOrderTypeOpt]
    categories: list[BlindsOrderCategoryOpt]
    allowed_category_ids_by_blinds_type: dict[str, list[str]]
    line_attribute_rows: list[BlindsLineAttributeRowOut]


@router.get("/prefill-from-estimate/{estimate_id}", response_model=OrderPrefillOut)
def prefill_from_estimate(
    estimate_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("orders.view"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    eid = estimate_id.strip()
    row = db.execute(
        text(
            f"""
            SELECT
              e.id AS estimate_id,
              e.customer_id,
              trim(concat_ws(' ', c.name, c.surname)) AS customer_display,
              e.visit_notes,
              COALESCE(e.status, 'pending') AS estimate_status,
              ( {_SQL_BLINDS_SUMMARY} ) AS blinds_summary,
              ( {_SQL_BLINDS_LINES_JSON} ) AS blinds_lines_json,
              e.scheduled_start_at,
              e.tarih_saat,
              co.tax_rate_percent AS company_tax_rate_percent
            FROM estimate e
            JOIN customers c ON c.company_id = e.company_id AND c.id = e.customer_id
            JOIN companies co ON co.id = e.company_id
            WHERE e.company_id = CAST(:cid AS uuid) AND e.id = :eid
            LIMIT 1
            """
        ),
        {"cid": str(cid), "eid": eid},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Estimate not found.")
    d = dict(row)
    raw_sched = d.pop("scheduled_start_at", None) or d.pop("tarih_saat", None)
    sched_summary: str | None = None
    if raw_sched is not None:
        if isinstance(raw_sched, datetime):
            sched_summary = raw_sched.isoformat()
        else:
            sched_summary = str(raw_sched)
    raw_rate = d.get("company_tax_rate_percent")
    ctp: Decimal | None = None
    if raw_rate is not None:
        ctp = Decimal(str(raw_rate))
    return OrderPrefillOut(
        estimate_id=d["estimate_id"],
        customer_id=d["customer_id"],
        customer_display=d["customer_display"],
        visit_notes=(d.get("visit_notes") or None),
        blinds_summary=(d.get("blinds_summary") or None),
        blinds_lines=_normalize_blinds_lines(d.get("blinds_lines_json")),
        schedule_summary=sched_summary,
        estimate_status=d["estimate_status"],
        company_tax_rate_percent=ctp,
    )


@router.get("/lookup/order-statuses", response_model=list[OrderStatusLookupOut])
def list_order_statuses_for_orders(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("orders.view"))],
):
    """Active rows from `status_order` for the order status dropdown (same source as list label)."""
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    rows = db.execute(
        text(
            """
            SELECT id, name
            FROM status_order
            WHERE company_id = CAST(:cid AS uuid) AND active IS TRUE
            ORDER BY name ASC
            """
        ),
        {"cid": str(cid)},
    ).mappings().all()
    return [OrderStatusLookupOut(**dict(r)) for r in rows]


@router.get("/lookup/blinds-order-options", response_model=BlindsOrderOptionsOut)
def blinds_order_options(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("orders.view"))],
):
    """Blinds types, product categories, and allowed type×category pairs for the order form.

    Lifting/cassette and other line extras are configured under Settings but captured on separate
    detail forms; the order screen only uses product category per line plus line note/amount.
    """
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    types_ = db.execute(
        text(
            """
            SELECT id, name
            FROM blinds_type
            WHERE company_id = CAST(:cid AS uuid) AND active IS TRUE
            ORDER BY name ASC
            """
        ),
        {"cid": str(cid)},
    ).mappings().all()
    cats = db.execute(
        text(
            """
            SELECT code AS id, name, sort_order
            FROM blinds_product_category
            WHERE active IS TRUE
            ORDER BY sort_order ASC, name ASC
            """
        ),
    ).mappings().all()
    allowed = load_allowed_category_ids_by_type(db, cid)
    cat_opts = [
        BlindsOrderCategoryOpt(
            id=str(r["id"]),
            name=str(r["name"]),
            sort_order=int(r["sort_order"] or 0),
        )
        for r in cats
    ]
    rows: list[BlindsLineAttributeRowOut] = [
        BlindsLineAttributeRowOut(
            kind_id="product_category",
            label="Product category",
            json_key="category",
            sort_order=0,
            options=cat_opts,
            allowed_option_ids_by_blinds_type=allowed,
        )
    ]
    return BlindsOrderOptionsOut(
        blinds_types=[BlindsOrderTypeOpt(id=str(r["id"]), name=str(r["name"])) for r in types_],
        categories=cat_opts,
        allowed_category_ids_by_blinds_type=allowed,
        line_attribute_rows=rows,
    )


@router.get("", response_model=list[OrderListItemOut])
def list_orders(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("orders.view"))],
    search: str | None = Query(None, max_length=200),
    limit: int = Query(200, ge=1, le=500),
    include_deleted: bool = Query(False),
    status_orde_id: str | None = Query(None, max_length=16),
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    where = ["o.company_id = CAST(:cid AS uuid)"]
    if not include_deleted:
        where.append("o.active IS TRUE")
    params: dict[str, Any] = {"cid": str(cid), "limit": limit}
    sid = (status_orde_id or "").strip()
    if sid:
        params["sid"] = sid
        where.append("o.status_orde_id = :sid")
    term = (search or "").strip()
    if term:
        params["term"] = f"%{term}%"
        where.append(
            "("
            "o.id ILIKE :term OR "
            "c.name ILIKE :term OR COALESCE(c.surname,'') ILIKE :term OR "
            "o.estimate_id ILIKE :term"
            ")"
        )
    w = " AND ".join(where)
    rows = db.execute(
        text(
            f"""
            SELECT
              o.company_id,
              o.id,
              o.customer_id,
              trim(concat_ws(' ', c.name, c.surname)) AS customer_display,
              o.estimate_id,
              o.total_amount,
              o.downpayment,
              o.balance,
              o.tax_uygulanacak_miktar,
              o.tax_amount,
              o.status_code,
              so.name AS status_order_label,
              o.agreement_date,
              o.created_at,
              o.active
            FROM orders o
            JOIN customers c ON c.company_id = o.company_id AND c.id = o.customer_id
            LEFT JOIN status_order so ON so.company_id = o.company_id AND so.id = o.status_orde_id
            WHERE {w}
            ORDER BY o.created_at DESC NULLS LAST
            LIMIT :limit
            """
        ),
        params,
    ).mappings().all()
    return [OrderListItemOut(**dict(r)) for r in rows]


@router.get("/{order_id}", response_model=OrderDetailOut)
def get_order(
    order_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("orders.view"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    oid = order_id.strip()
    row = db.execute(
        text(
            """
            SELECT
              o.company_id,
              o.id,
              o.customer_id,
              trim(concat_ws(' ', c.name, c.surname)) AS customer_display,
              o.estimate_id,
              o.total_amount,
              o.downpayment,
              o.final_payment,
              o.balance,
              o.tax_uygulanacak_miktar,
              o.tax_amount,
              o.blinds_lines AS blinds_lines_json,
              o.order_note,
              o.agree_data,
              o.agreement_date,
              o.status_code,
              o.status_orde_id,
              so.name AS status_order_label,
              o.created_at,
              o.updated_at,
              o.active
            FROM orders o
            JOIN customers c ON c.company_id = o.company_id AND c.id = o.customer_id
            LEFT JOIN status_order so ON so.company_id = o.company_id AND so.id = o.status_orde_id
            WHERE o.company_id = CAST(:cid AS uuid) AND o.id = :oid
            LIMIT 1
            """
        ),
        {"cid": str(cid), "oid": oid},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Order not found.")
    d = dict(row)
    lines = _normalize_blinds_lines(d.pop("blinds_lines_json", None))
    return OrderDetailOut(**d, blinds_lines=lines)


@router.delete("/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_order(
    order_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("orders.edit"))],
):
    """Soft delete: mark order inactive (active = FALSE)."""
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    oid = order_id.strip()
    res = db.execute(
        text(
            """
            UPDATE orders
            SET active = FALSE, updated_at = NOW()
            WHERE company_id = CAST(:cid AS uuid) AND id = :oid AND active IS TRUE
            """
        ),
        {"cid": str(cid), "oid": oid},
    )
    if res.rowcount == 0:
        exists = db.execute(
            text("SELECT 1 FROM orders WHERE company_id = CAST(:cid AS uuid) AND id = :oid LIMIT 1"),
            {"cid": str(cid), "oid": oid},
        ).first()
        if not exists:
            raise HTTPException(status_code=404, detail="Order not found.")
        raise HTTPException(status_code=400, detail="Order is already deleted.")
    db.commit()
    return None


@router.post("/{order_id}/restore", response_model=OrderDetailOut)
def restore_order(
    order_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("orders.edit"))],
):
    """Restore a soft-deleted order (active = TRUE)."""
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    oid = order_id.strip()
    res = db.execute(
        text(
            """
            UPDATE orders
            SET active = TRUE, updated_at = NOW()
            WHERE company_id = CAST(:cid AS uuid) AND id = :oid AND active IS FALSE
            """
        ),
        {"cid": str(cid), "oid": oid},
    )
    if res.rowcount == 0:
        exists = db.execute(
            text("SELECT 1 FROM orders WHERE company_id = CAST(:cid AS uuid) AND id = :oid LIMIT 1"),
            {"cid": str(cid), "oid": oid},
        ).first()
        if not exists:
            raise HTTPException(status_code=404, detail="Order not found.")
        raise HTTPException(status_code=400, detail="Order is not deleted.")
    db.commit()
    return get_order(order_id=oid, db=db, current_user=current_user)


@router.post("", response_model=OrderDetailOut, status_code=status.HTTP_201_CREATED)
def create_order(
    body: OrderCreateIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("orders.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    cust_id = body.customer_id.strip()

    cust = db.execute(
        text(
            """
            SELECT 1 FROM customers
            WHERE company_id = CAST(:cid AS uuid) AND id = :cust AND active IS TRUE
            LIMIT 1
            """
        ),
        {"cid": str(cid), "cust": cust_id},
    ).first()
    if not cust:
        raise HTTPException(status_code=400, detail="Invalid or inactive customer.")

    est_id = (body.estimate_id or "").strip() or None
    if est_id:
        taken = db.execute(
            text(
                """
                SELECT 1 FROM orders
                WHERE company_id = CAST(:cid AS uuid) AND estimate_id = :eid
                LIMIT 1
                """
            ),
            {"cid": str(cid), "eid": est_id},
        ).first()
        if taken:
            raise HTTPException(
                status_code=409,
                detail="An order already exists for this estimate.",
            )
        er = db.execute(
            text(
                """
                SELECT customer_id, COALESCE(status, 'pending') AS st, COALESCE(is_deleted, FALSE) AS is_deleted
                FROM estimate
                WHERE company_id = CAST(:cid AS uuid) AND id = :eid
                LIMIT 1
                """
            ),
            {"cid": str(cid), "eid": est_id},
        ).mappings().first()
        if not er:
            raise HTTPException(status_code=400, detail="Invalid estimate.")
        if er["is_deleted"]:
            raise HTTPException(status_code=400, detail="Estimate is deleted.")
        if er["customer_id"] != cust_id:
            raise HTTPException(status_code=400, detail="Customer must match the estimate.")
        if er["st"] == "converted":
            raise HTTPException(
                status_code=409,
                detail="This estimate is already converted; open the existing order or unlink first.",
            )
        if er["st"] == "cancelled":
            raise HTTPException(
                status_code=400,
                detail="Cannot create an order from a cancelled estimate.",
            )

    status_ord = _ensure_default_order_status_id(db, company_id=cid)
    down = body.downpayment
    rate_pct = _company_tax_rate_percent(db, cid)
    tax_amt = _tax_amount_from_base(body.tax_uygulanacak_miktar, rate_pct)

    lines = _normalize_blinds_lines(body.blinds_lines or [])
    if not lines:
        raise HTTPException(status_code=400, detail="Choose at least one blinds type.")
    validate_blinds_lines_categories(db, cid, lines)
    total_amount: Decimal | None = _sum_blinds_line_amounts(lines)
    balance: Decimal | None = _balance_with_tax(total_amount, down, tax_amt)

    for _ in range(5):
        new_id = _new_order_id()
        exists = db.execute(
            text("SELECT 1 FROM orders WHERE company_id = CAST(:cid AS uuid) AND id = :id LIMIT 1"),
            {"cid": str(cid), "id": new_id},
        ).first()
        if exists:
            continue
        try:
            db.execute(
                text(
                    """
                    INSERT INTO orders (
                      company_id, id, customer_id,
                      total_amount, downpayment, final_payment, balance,
                      agree_data, agreement_date,
                      estimate_id, status_orde_id,
                      active, status_code,
                      created_at, updated_at
                    )
                    VALUES (
                      CAST(:cid AS uuid), :id, :customer_id,
                      :total_amount, :downpayment, NULL, :balance,
                      NULL, :agreement_date,
                      :estimate_id, :status_orde_id,
                      TRUE, 'order_created',
                      NOW(), NOW()
                    )
                    """
                ),
                {
                    "cid": str(cid),
                    "id": new_id,
                    "customer_id": cust_id,
                    "total_amount": total_amount,
                    "downpayment": down,
                    "balance": balance,
                    "agreement_date": body.agreement_date,
                    "estimate_id": est_id,
                    "status_orde_id": status_ord,
                },
            )
            db.execute(
                text(
                    """
                    UPDATE orders
                    SET
                      tax_uygulanacak_miktar = COALESCE(:tax_base, tax_uygulanacak_miktar),
                      tax_amount = :tax_amt,
                      blinds_lines = CAST(:blinds_lines AS jsonb),
                      order_note = :order_note
                    WHERE company_id = CAST(:cid AS uuid) AND id = :oid
                    """
                ),
                {
                    "cid": str(cid),
                    "oid": new_id,
                    "tax_base": body.tax_uygulanacak_miktar,
                    "tax_amt": tax_amt,
                    "blinds_lines": json.dumps(lines),
                    "order_note": _normalize_order_note(body.order_note),
                },
            )
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=400, detail="Could not create order (invalid data).")
        return get_order(order_id=new_id, db=db, current_user=current_user)

    raise HTTPException(status_code=500, detail="Could not allocate order id, try again.")


@router.patch("/{order_id}", response_model=OrderDetailOut)
def patch_order(
    order_id: str,
    body: OrderPatchIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("orders.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    oid = order_id.strip()
    cur = db.execute(
        text(
            """
            SELECT
              o.estimate_id,
              o.customer_id,
              o.status_code,
              o.total_amount,
              o.downpayment,
              o.tax_amount,
              o.agree_data
            FROM orders o
            WHERE o.company_id = CAST(:cid AS uuid) AND o.id = :oid AND o.active IS TRUE
            LIMIT 1
            """
        ),
        {"cid": str(cid), "oid": oid},
    ).mappings().first()
    if not cur:
        raise HTTPException(status_code=404, detail="Order not found.")

    sets: list[str] = []
    params: dict[str, Any] = {"cid": str(cid), "oid": oid}
    patch_fields = body.model_dump(exclude_unset=True)

    eff_total: Any = cur.get("total_amount")
    eff_down: Any = cur.get("downpayment")
    eff_tax: Any = cur.get("tax_amount")

    if "blinds_lines" in patch_fields:
        normalized_lines = _normalize_blinds_lines(patch_fields["blinds_lines"])
        if not normalized_lines:
            raise HTTPException(status_code=400, detail="Choose at least one blinds type.")
        validate_blinds_lines_categories(db, cid, normalized_lines)
        sets.append("blinds_lines = CAST(:blinds_lines_patch AS jsonb)")
        params["blinds_lines_patch"] = json.dumps(normalized_lines)
        line_total = _sum_blinds_line_amounts(normalized_lines)
        sets.append("total_amount = :total_from_lines")
        params["total_from_lines"] = line_total
        eff_total = line_total
    elif body.total_amount is not None:
        sets.append("total_amount = :total_amount")
        params["total_amount"] = body.total_amount
        eff_total = body.total_amount

    if body.downpayment is not None:
        sets.append("downpayment = :downpayment")
        params["downpayment"] = body.downpayment
        eff_down = body.downpayment

    if "tax_uygulanacak_miktar" in patch_fields:
        tb = patch_fields["tax_uygulanacak_miktar"]
        sets.append("tax_uygulanacak_miktar = :tax_base")
        params["tax_base"] = tb
        rate_pct = _company_tax_rate_percent(db, cid)
        sets.append("tax_amount = :tax_amt")
        params["tax_amt"] = _tax_amount_from_base(tb, rate_pct)
        eff_tax = params["tax_amt"]

    if "agreement_date" in patch_fields:
        sets.append("agreement_date = :adate")
        params["adate"] = patch_fields["agreement_date"]

    if "status_orde_id" in patch_fields:
        sid_raw = patch_fields["status_orde_id"]
        if sid_raw is None or not str(sid_raw).strip():
            sets.append("status_orde_id = NULL")
        else:
            sid = str(sid_raw).strip()
            ok = db.execute(
                text(
                    """
                    SELECT 1 FROM status_order
                    WHERE company_id = CAST(:cid AS uuid) AND id = :sid AND active IS TRUE
                    LIMIT 1
                    """
                ),
                {"cid": str(cid), "sid": sid},
            ).first()
            if not ok:
                raise HTTPException(status_code=400, detail="Invalid or inactive order status.")
            sets.append("status_orde_id = :status_ord_id")
            params["status_ord_id"] = sid

    if "customer_id" in patch_fields:
        new_cust = (patch_fields["customer_id"] or "").strip()
        if not new_cust:
            raise HTTPException(status_code=400, detail="customer_id cannot be empty.")
        if (cur.get("estimate_id") or "").strip():
            raise HTTPException(
                status_code=400,
                detail="Cannot change customer: order is linked to an estimate.",
            )
        ok_c = db.execute(
            text(
                """
                SELECT 1 FROM customers
                WHERE company_id = CAST(:cid AS uuid) AND id = :cust AND active IS TRUE
                LIMIT 1
                """
            ),
            {"cid": str(cid), "cust": new_cust},
        ).first()
        if not ok_c:
            raise HTTPException(status_code=400, detail="Invalid or inactive customer.")
        sets.append("customer_id = :patched_customer_id")
        params["patched_customer_id"] = new_cust

    if body.status_code is not None:
        sets.append("status_code = :sc")
        params["sc"] = body.status_code

    if "order_note" in patch_fields:
        sets.append("order_note = :order_note")
        params["order_note"] = _normalize_order_note(patch_fields.get("order_note"))

    if eff_total is not None and eff_down is not None:
        sets.append("balance = :balance")
        params["balance"] = _balance_with_tax(eff_total, eff_down, eff_tax)

    if not sets:
        raise HTTPException(status_code=400, detail="No changes submitted.")

    next_sc = (body.status_code or cur.get("status_code") or "").strip()
    if next_sc == "in_production" and not (cur.get("agree_data") or "").strip():
        est_id = (cur.get("estimate_id") or "").strip()
        if est_id:
            pre = db.execute(
                text(
                    f"""
                    SELECT
                      trim(concat_ws(' ', c.name, c.surname)) AS customer_display,
                      e.visit_notes,
                      ( {_SQL_BLINDS_SUMMARY} ) AS blinds_summary,
                      e.scheduled_start_at,
                      e.tarih_saat
                    FROM estimate e
                    JOIN customers c ON c.company_id = e.company_id AND c.id = e.customer_id
                    WHERE e.company_id = CAST(:cid AS uuid) AND e.id = :eid
                    LIMIT 1
                    """
                ),
                {"cid": str(cid), "eid": est_id},
            ).mappings().first()
            if pre:
                raw_sched = pre.get("scheduled_start_at") or pre.get("tarih_saat")
                sched = (
                    raw_sched.isoformat()
                    if isinstance(raw_sched, datetime)
                    else (str(raw_sched) if raw_sched else None)
                )
                blocks: list[str] = [f"Estimate: {est_id}"]
                if (pre.get("customer_display") or "").strip():
                    blocks.append(f"Customer: {str(pre.get('customer_display')).strip()}")
                if (pre.get("blinds_summary") or "").strip():
                    blocks.append(f"Blinds: {str(pre.get('blinds_summary')).strip()}")
                if sched:
                    blocks.append(f"Visit: {sched}")
                if (pre.get("visit_notes") or "").strip():
                    blocks.append(f"Notes: {str(pre.get('visit_notes')).strip()}")
                sets.append("agree_data = :agree_data")
                params["agree_data"] = "\n\n".join(blocks)

    sets.append("updated_at = NOW()")
    db.execute(
        text(
            f"""
            UPDATE orders
            SET {", ".join(sets)}
            WHERE company_id = CAST(:cid AS uuid) AND id = :oid AND active IS TRUE
            """
        ),
        params,
    )
    db.commit()
    return get_order(order_id=oid, db=db, current_user=current_user)
