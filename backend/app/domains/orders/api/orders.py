"""Orders CRUD (list, create) scoped to active company."""

import json
import secrets
from datetime import date, datetime, time, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from app.core.config import settings
from app.core.database import get_db
from app.dependencies.auth import effective_company_id, require_permissions
from app.domains.user.models.users import Users
from app.domains.business_lookups.services.blinds_catalog import (
    load_allowed_category_ids_by_type,
    normalize_blinds_line_category_value,
    validate_blinds_lines_categories,
)
from app.integrations.google_calendar_service import try_push_order_installation_to_google_calendar


router = APIRouter(prefix="/orders", tags=["Orders"])

ORDER_PHOTO_MAX_BYTES = 15 * 1024 * 1024
ORDER_EXCEL_MAX_BYTES = 25 * 1024 * 1024
ORDER_PHOTO_TYPES: dict[str, str] = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
ORDER_EXCEL_TYPES: dict[str, str] = {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
    "application/vnd.ms-excel": ".xls",
    "text/csv": ".csv",
}


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


def _order_balance(
    total: Decimal | None,
    down: Decimal | None,
    tax_amt: Decimal | None,
    final_pay: Decimal | None = None,
) -> Decimal | None:
    """Amount still owed: total + tax − down payment − extra payments (final_payment)."""
    if total is None:
        return None
    t = Decimal(str(total))
    d = Decimal("0") if down is None else Decimal(str(down))
    tax_part = Decimal("0") if tax_amt is None else Decimal(str(tax_amt))
    fp = Decimal("0") if final_pay is None else Decimal(str(final_pay))
    return t - d - fp + tax_part


def _new_order_id() -> str:
    return secrets.token_hex(8)


def _new_row_id() -> str:
    return secrets.token_hex(8)


def _orders_upload_dir(company_id: UUID, order_id: str) -> Path:
    return settings.resolved_upload_root() / "orders" / str(company_id) / order_id


def _safe_upload_basename(name: str, max_len: int = 100) -> str:
    base = Path(name).name
    cleaned = "".join(c for c in base if c.isalnum() or c in "._- ")
    return (cleaned.strip() or "file")[:max_len]


def _normalize_upload_content_type(raw: str | None) -> str:
    if not raw:
        return ""
    return raw.split(";")[0].strip().lower()


def _sync_order_final_payment_from_entries(db: Session, cid: UUID, oid: str) -> None:
    q = Decimal("0.01")
    r = db.execute(
        text(
            """
            SELECT COALESCE(SUM(amount), 0) AS s
            FROM order_payment_entries
            WHERE company_id = CAST(:cid AS uuid) AND order_id = :oid
              AND COALESCE(is_deleted, FALSE) = FALSE
            """
        ),
        {"cid": str(cid), "oid": oid},
    ).mappings().first()
    sum_fp = Decimal(str(r["s"])).quantize(q, rounding=ROUND_HALF_UP) if r else Decimal("0")
    orow = db.execute(
        text(
            """
            SELECT total_amount, downpayment, tax_amount
            FROM orders
            WHERE company_id = CAST(:cid AS uuid) AND id = :oid AND active IS TRUE
            LIMIT 1
            """
        ),
        {"cid": str(cid), "oid": oid},
    ).mappings().first()
    if not orow:
        return
    bal = _order_balance(orow["total_amount"], orow["downpayment"], orow["tax_amount"], sum_fp)
    if bal is not None:
        bal = bal.quantize(q, rounding=ROUND_HALF_UP)
    db.execute(
        text(
            """
            UPDATE orders
            SET final_payment = :fp, balance = :bal, updated_at = NOW()
            WHERE company_id = CAST(:cid AS uuid) AND id = :oid AND active IS TRUE
            """
        ),
        {"cid": str(cid), "oid": oid, "fp": sum_fp, "bal": bal},
    )


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
        'window_count', eb.perde_sayisi,
        'line_amount', eb.line_amount
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
        'window_count', e.perde_sayisi,
        'line_amount', NULL
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
    """Resolve global 'New order' status for the company (matrix + catalog)."""
    from app.domains.business_lookups.services.global_status_seed import (
        DEFAULT_ORDER_STATUS_ID,
        ensure_company_order_matrix_defaults,
        ensure_global_catalog_seeded,
    )

    ensure_global_catalog_seeded(db)
    ensure_company_order_matrix_defaults(db, company_id)
    row = db.execute(
        text(
            """
            SELECT so.id
            FROM status_order so
            INNER JOIN company_status_order_matrix m
              ON m.status_order_id = so.id AND m.company_id = CAST(:cid AS uuid)
            WHERE so.active IS TRUE AND lower(trim(so.name)) = 'new order'
            LIMIT 1
            """
        ),
        {"cid": str(company_id)},
    ).mappings().first()
    if row:
        return str(row["id"])
    return DEFAULT_ORDER_STATUS_ID


def _new_customer_id_for_order() -> str:
    return secrets.token_hex(8)


def _ready_for_install_order_status_id(db: Session, company_id: UUID) -> str | None:
    from app.domains.business_lookups.services.global_status_seed import (
        READY_FOR_INSTALL_ORDER_STATUS_ID,
    )

    ok = db.execute(
        text(
            """
            SELECT 1
            FROM status_order so
            INNER JOIN company_status_order_matrix m
              ON m.status_order_id = so.id AND m.company_id = CAST(:cid AS uuid)
            WHERE so.id = :rid AND so.active IS TRUE
            LIMIT 1
            """
        ),
        {"cid": str(company_id), "rid": READY_FOR_INSTALL_ORDER_STATUS_ID},
    ).first()
    if ok:
        return READY_FOR_INSTALL_ORDER_STATUS_ID
    row = db.execute(
        text(
            """
            SELECT so.id
            FROM status_order so
            INNER JOIN company_status_order_matrix m
              ON m.status_order_id = so.id AND m.company_id = CAST(:cid AS uuid)
            WHERE so.active IS TRUE AND lower(trim(so.name)) = 'ready for installation'
            LIMIT 1
            """
        ),
        {"cid": str(company_id)},
    ).mappings().first()
    return str(row["id"]) if row else None


def _is_ready_for_install_order_status(
    db: Session, company_id: UUID, status_orde_id: str | None
) -> bool:
    if not status_orde_id or not str(status_orde_id).strip():
        return False
    exp = _ready_for_install_order_status_id(db, company_id)
    return bool(exp and exp == str(status_orde_id).strip())


def _insert_customer_from_prospect_and_link_estimate(
    db: Session,
    company_id: UUID,
    estimate_id: str,
    est: dict[str, Any],
) -> str:
    name = (est.get("prospect_name") or "").strip()
    if not name:
        raise HTTPException(
            status_code=400,
            detail="This estimate has no customer record yet. Add prospect name on the estimate before creating an order.",
        )
    surname = (est.get("prospect_surname") or "").strip() or None
    phone = (est.get("prospect_phone") or "").strip() or None
    email = (est.get("prospect_email") or "").strip() or None
    address = (est.get("prospect_address") or "").strip() or None
    postal_code = (est.get("prospect_postal_code") or "").strip() or None
    for _ in range(8):
        new_id = _new_customer_id_for_order()
        exists = db.execute(
            text(
                "SELECT 1 FROM customers WHERE company_id = CAST(:cid AS uuid) AND id = :id LIMIT 1"
            ),
            {"cid": str(company_id), "id": new_id},
        ).first()
        if exists:
            continue
        try:
            db.execute(
                text(
                    """
                    INSERT INTO customers (
                      company_id, id, name, surname, phone, email, address, postal_code, status_user_id, active
                    )
                    VALUES (
                      CAST(:cid AS uuid), :id, :name, :surname, :phone, :email, :address, :postal_code, NULL, TRUE
                    )
                    """
                ),
                {
                    "cid": str(company_id),
                    "id": new_id,
                    "name": name,
                    "surname": surname,
                    "phone": phone,
                    "email": email,
                    "address": address,
                    "postal_code": postal_code,
                },
            )
            db.execute(
                text(
                    """
                    UPDATE estimate
                    SET
                      customer_id = :nid,
                      prospect_name = NULL,
                      prospect_surname = NULL,
                      prospect_phone = NULL,
                      prospect_email = NULL,
                      prospect_address = NULL,
                      prospect_postal_code = NULL,
                      updated_at = NOW()
                    WHERE company_id = CAST(:cid AS uuid) AND id = :eid
                    """
                ),
                {"cid": str(company_id), "nid": new_id, "eid": estimate_id},
            )
            return new_id
        except IntegrityError as exc:
            raise HTTPException(
                status_code=400,
                detail="Could not create customer (duplicate email or invalid data).",
            ) from exc
    raise HTTPException(status_code=500, detail="Could not allocate customer id.")


def _resolve_customer_for_estimate_order(
    db: Session,
    company_id: UUID,
    estimate_id: str,
    body_customer_id: str | None,
    *,
    estimate_row: dict[str, Any],
) -> str:
    existing = (estimate_row.get("customer_id") or "").strip()
    if existing:
        bc = (body_customer_id or "").strip()
        if bc and bc != existing:
            raise HTTPException(status_code=400, detail="Customer must match the estimate.")
        ok = db.execute(
            text(
                """
                SELECT 1 FROM customers
                WHERE company_id = CAST(:cid AS uuid) AND id = :cust AND active IS TRUE
                LIMIT 1
                """
            ),
            {"cid": str(company_id), "cust": existing},
        ).first()
        if not ok:
            raise HTTPException(status_code=400, detail="Invalid or inactive customer.")
        return existing
    bc = (body_customer_id or "").strip()
    if bc:
        ok = db.execute(
            text(
                """
                SELECT 1 FROM customers
                WHERE company_id = CAST(:cid AS uuid) AND id = :cust AND active IS TRUE
                LIMIT 1
                """
            ),
            {"cid": str(company_id), "cust": bc},
        ).first()
        if not ok:
            raise HTTPException(status_code=400, detail="Invalid or inactive customer.")
        db.execute(
            text(
                """
                UPDATE estimate
                SET
                  customer_id = :cust,
                  prospect_name = NULL,
                  prospect_surname = NULL,
                  prospect_phone = NULL,
                  prospect_email = NULL,
                  prospect_address = NULL,
                  updated_at = NOW()
                WHERE company_id = CAST(:cid AS uuid) AND id = :eid
                """
            ),
            {"cid": str(company_id), "cust": bc, "eid": estimate_id},
        )
        return bc
    return _insert_customer_from_prospect_and_link_estimate(
        db, company_id, estimate_id, estimate_row
    )


class OrderPrefillOut(BaseModel):
    estimate_id: str
    customer_id: str | None = None
    customer_display: str
    visit_notes: str | None = None
    blinds_summary: str | None = None
    blinds_lines: list[dict[str, Any]] = Field(default_factory=list)
    schedule_summary: str | None = None
    estimate_status: str | None = None
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
    final_payment: Decimal | None = None
    balance: Decimal | None = None
    tax_uygulanacak_miktar: Decimal | None = None
    tax_amount: Decimal | None = None
    status_code: str
    status_order_label: str | None = None
    agreement_date: date | None = None
    created_at: Any | None = None
    active: bool = True


class OrderCreateIn(BaseModel):
    customer_id: str | None = Field(None, max_length=16)
    estimate_id: str | None = Field(None, max_length=16)
    tax_uygulanacak_miktar: Decimal | None = None
    total_amount: Decimal | None = None
    downpayment: Decimal | None = None
    agreement_date: date | None = None
    # agree_data is assigned later when status moves to in_production
    blinds_lines: list[dict[str, Any]] = Field(default_factory=list)
    order_note: str | None = Field(None, max_length=4000)

    @model_validator(mode="after")
    def normalize_ids(self) -> "OrderCreateIn":
        est = (self.estimate_id or "").strip() or None
        self.estimate_id = est
        c = (self.customer_id or "").strip() or None
        self.customer_id = c
        if not est and not c:
            raise ValueError("customer_id is required when estimate_id is not set.")
        return self


class OrderAttachmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    kind: str
    filename: str
    url: str
    created_at: Any


class OrderPaymentEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    amount: Decimal
    paid_at: datetime


def _down_payment_paid_at(agreement_date: Any, created_at: Any) -> datetime:
    """Display timestamp for the synthetic down-payment line (agreement date start of day, else order created)."""
    if agreement_date is not None:
        if isinstance(agreement_date, datetime):
            return agreement_date
        if isinstance(agreement_date, date):
            return datetime.combine(agreement_date, time.min, tzinfo=timezone.utc)
    if isinstance(created_at, datetime):
        return created_at
    return datetime.now(timezone.utc)


def _build_payment_entries_for_detail(
    downpayment: Any,
    agreement_date: Any,
    created_at: Any,
    pay_rows: list[Any],
) -> list[OrderPaymentEntryOut]:
    q = Decimal("0.01")
    out: list[OrderPaymentEntryOut] = []
    down_d = (
        Decimal("0")
        if downpayment is None
        else Decimal(str(downpayment)).quantize(q, rounding=ROUND_HALF_UP)
    )
    if down_d > 0:
        out.append(
            OrderPaymentEntryOut(
                id="downpayment",
                amount=down_d,
                paid_at=_down_payment_paid_at(agreement_date, created_at),
            )
        )
    out.extend(OrderPaymentEntryOut(**dict(pr)) for pr in pay_rows)
    out.sort(key=lambda e: (e.paid_at, 0 if e.id == "downpayment" else 1))
    return out


def _fetch_order_attachments(db: Session, cid: UUID, oid: str) -> list[OrderAttachmentOut]:
    rows = db.execute(
        text(
            """
            SELECT id::text AS id, kind, original_filename, stored_relpath, created_at
            FROM order_attachments
            WHERE company_id = CAST(:cid AS uuid) AND order_id = :oid
              AND COALESCE(is_deleted, FALSE) = FALSE
            ORDER BY created_at DESC
            """
        ),
        {"cid": str(cid), "oid": oid},
    ).mappings().all()
    return [
        OrderAttachmentOut(
            id=str(r["id"]),
            kind=str(r["kind"]),
            filename=str(r["original_filename"]),
            url=f"/uploads/{r['stored_relpath']}",
            created_at=r["created_at"],
        )
        for r in rows
    ]


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
    payment_entries: list[OrderPaymentEntryOut] = Field(default_factory=list)
    attachments: list[OrderAttachmentOut] = Field(default_factory=list)
    order_note: str | None = None
    agree_data: str | None = None
    agreement_date: date | None = None
    status_code: str
    status_orde_id: str | None = None
    status_order_label: str | None = None
    installation_scheduled_start_at: datetime | None = None
    installation_scheduled_end_at: datetime | None = None
    created_at: Any | None = None
    updated_at: Any | None = None
    active: bool = True


class OrderRecordPaymentIn(BaseModel):
    amount: Decimal = Field(..., gt=0)


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
    installation_scheduled_start_at: datetime | None = None
    installation_scheduled_end_at: datetime | None = None


class OrderStatusLookupOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    sort_order: int = 0


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
              COALESCE(
                NULLIF(trim(concat_ws(' ', c.name, c.surname)), ''),
                NULLIF(trim(concat_ws(' ', e.prospect_name, e.prospect_surname)), ''),
                'Prospect'
              ) AS customer_display,
              e.visit_notes,
              se.builtin_kind AS estimate_status,
              ( {_SQL_BLINDS_SUMMARY} ) AS blinds_summary,
              ( {_SQL_BLINDS_LINES_JSON} ) AS blinds_lines_json,
              e.scheduled_start_at,
              e.tarih_saat,
              co.tax_rate_percent AS company_tax_rate_percent
            FROM estimate e
            LEFT JOIN customers c ON c.company_id = e.company_id AND c.id = e.customer_id
            JOIN companies co ON co.id = e.company_id
            LEFT JOIN status_estimate se ON se.id = e.status_esti_id
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
            SELECT so.id, so.name, so.sort_order
            FROM status_order so
            INNER JOIN company_status_order_matrix m
              ON m.status_order_id = so.id AND m.company_id = CAST(:cid AS uuid)
            WHERE so.active IS TRUE
            ORDER BY so.sort_order ASC, so.name ASC
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
              o.final_payment,
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
            LEFT JOIN status_order so ON so.id = o.status_orde_id
            WHERE {w}
            ORDER BY o.created_at DESC NULLS LAST
            LIMIT :limit
            """
        ),
        params,
    ).mappings().all()
    return [OrderListItemOut(**dict(r)) for r in rows]


@router.post("/{order_id}/record-payment", response_model=OrderDetailOut)
def record_order_payment(
    order_id: str,
    body: OrderRecordPaymentIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("orders.edit"))],
):
    """Add to cumulative post-down payment total (`final_payment`) and refresh `balance`."""
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    oid = order_id.strip()
    q = Decimal("0.01")
    pay_amt = Decimal(str(body.amount)).quantize(q, rounding=ROUND_HALF_UP)
    if pay_amt <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive.")
    row = db.execute(
        text(
            """
            SELECT
              o.total_amount,
              o.downpayment,
              o.tax_amount,
              o.final_payment,
              o.balance,
              o.active
            FROM orders o
            WHERE o.company_id = CAST(:cid AS uuid) AND o.id = :oid
            LIMIT 1
            """
        ),
        {"cid": str(cid), "oid": oid},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Order not found.")
    if not row.get("active"):
        raise HTTPException(status_code=400, detail="Cannot record payment on a deleted order.")
    total = row.get("total_amount")
    if total is None:
        raise HTTPException(status_code=400, detail="Order has no total amount.")
    cur_fp = row.get("final_payment")
    cur_fp_d = Decimal("0") if cur_fp is None else Decimal(str(cur_fp))
    down = row.get("downpayment")
    tax_amt = row.get("tax_amount")
    owed = _order_balance(Decimal(str(total)), down, tax_amt, cur_fp_d)
    if owed is None:
        raise HTTPException(status_code=400, detail="Cannot compute balance for this order.")
    owed_q = owed.quantize(q, rounding=ROUND_HALF_UP)
    if pay_amt > owed_q:
        raise HTTPException(
            status_code=400,
            detail="Payment exceeds balance due.",
        )
    db.execute(
        text(
            """
            INSERT INTO order_payment_entries (company_id, order_id, amount)
            VALUES (CAST(:cid AS uuid), :oid, :amt)
            """
        ),
        {"cid": str(cid), "oid": oid, "amt": pay_amt},
    )
    _sync_order_final_payment_from_entries(db, cid, oid)
    db.commit()
    return get_order(order_id=oid, db=db, current_user=current_user)


@router.delete(
    "/{order_id}/payment-entries/{entry_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def soft_delete_order_payment_entry(
    order_id: str,
    entry_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("orders.edit"))],
):
    """Soft-delete a recorded payment row; recomputes `final_payment` and `balance` from active rows."""
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    oid = order_id.strip()
    try:
        eid = UUID(entry_id.strip())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Payment entry not found.") from exc
    res = db.execute(
        text(
            """
            UPDATE order_payment_entries
            SET is_deleted = TRUE
            WHERE company_id = CAST(:cid AS uuid) AND order_id = :oid AND id = CAST(:eid AS uuid)
              AND COALESCE(is_deleted, FALSE) = FALSE
            """
        ),
        {"cid": str(cid), "oid": oid, "eid": str(eid)},
    )
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Payment entry not found.")
    _sync_order_final_payment_from_entries(db, cid, oid)
    db.commit()
    return None


@router.post("/{order_id}/attachments", response_model=OrderDetailOut)
async def upload_order_attachment(
    order_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("orders.edit"))],
    kind: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    oid = order_id.strip()
    k = (kind or "").strip().lower()
    if k not in ("photo", "excel"):
        raise HTTPException(status_code=400, detail="kind must be photo or excel.")
    ok = db.execute(
        text(
            """
            SELECT 1 FROM orders
            WHERE company_id = CAST(:cid AS uuid) AND id = :oid AND active IS TRUE
            LIMIT 1
            """
        ),
        {"cid": str(cid), "oid": oid},
    ).first()
    if not ok:
        raise HTTPException(status_code=404, detail="Order not found.")
    ct = _normalize_upload_content_type(file.content_type)
    max_bytes = ORDER_PHOTO_MAX_BYTES if k == "photo" else ORDER_EXCEL_MAX_BYTES
    fn_low = (file.filename or "").lower()
    if k == "photo":
        ext = ORDER_PHOTO_TYPES.get(ct)
        if not ext and fn_low.endswith((".png", ".jpg", ".jpeg", ".webp", ".gif")):
            ext = Path(fn_low).suffix.lower()
            if ext == ".jpeg":
                ext = ".jpg"
            ct = ct or "image/jpeg"
        if not ext:
            raise HTTPException(
                status_code=400,
                detail="Invalid image type. Use PNG, JPEG, WebP, or GIF.",
            )
    else:
        ext = ORDER_EXCEL_TYPES.get(ct)
        if not ext:
            if fn_low.endswith(".xlsx"):
                ext, ct = ".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            elif fn_low.endswith(".xls"):
                ext, ct = ".xls", "application/vnd.ms-excel"
            elif fn_low.endswith(".csv"):
                ext, ct = ".csv", "text/csv"
        if not ext:
            raise HTTPException(
                status_code=400,
                detail="Invalid spreadsheet type. Use XLSX, XLS, or CSV.",
            )
    data = await file.read()
    if len(data) > max_bytes:
        raise HTTPException(status_code=400, detail="File too large.")
    safe = _safe_upload_basename(file.filename or f"upload{ext}")
    unique = f"{uuid4().hex}_{safe}"
    if not unique.lower().endswith(ext.lower()):
        unique = f"{unique}{ext}"
    dest_dir = _orders_upload_dir(cid, oid)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / unique
    rel = Path("orders") / str(cid) / oid / unique
    stored_relpath = rel.as_posix()
    dest_path.write_bytes(data)
    db.execute(
        text(
            """
            INSERT INTO order_attachments (
              company_id, order_id, kind, original_filename, stored_relpath, content_type, file_size
            )
            VALUES (
              CAST(:cid AS uuid), :oid, :kind, :oname, :spath, :ct, :fsz
            )
            """
        ),
        {
            "cid": str(cid),
            "oid": oid,
            "kind": k,
            "oname": safe,
            "spath": stored_relpath,
            "ct": ct or None,
            "fsz": len(data),
        },
    )
    db.commit()
    return get_order(order_id=oid, db=db, current_user=current_user)


@router.delete(
    "/{order_id}/attachments/{attachment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def soft_delete_order_attachment(
    order_id: str,
    attachment_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("orders.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    oid = order_id.strip()
    try:
        aid = UUID(attachment_id.strip())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Attachment not found.") from exc
    res = db.execute(
        text(
            """
            UPDATE order_attachments
            SET is_deleted = TRUE
            WHERE company_id = CAST(:cid AS uuid) AND order_id = :oid AND id = CAST(:aid AS uuid)
              AND COALESCE(is_deleted, FALSE) = FALSE
            """
        ),
        {"cid": str(cid), "oid": oid, "aid": str(aid)},
    )
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Attachment not found.")
    db.commit()
    return None


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
              o.installation_scheduled_start_at,
              o.installation_scheduled_end_at,
              o.created_at,
              o.updated_at,
              o.active
            FROM orders o
            JOIN customers c ON c.company_id = o.company_id AND c.id = o.customer_id
            LEFT JOIN status_order so ON so.id = o.status_orde_id
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
    pay_rows = db.execute(
        text(
            """
            SELECT id::text AS id, amount, created_at AS paid_at
            FROM order_payment_entries
            WHERE company_id = CAST(:cid AS uuid) AND order_id = :oid
              AND COALESCE(is_deleted, FALSE) = FALSE
            ORDER BY created_at ASC
            """
        ),
        {"cid": str(cid), "oid": oid},
    ).mappings().all()
    payment_entries = _build_payment_entries_for_detail(
        d.get("downpayment"),
        d.get("agreement_date"),
        d.get("created_at"),
        list(pay_rows),
    )
    attachments = _fetch_order_attachments(db, cid, oid)
    return OrderDetailOut(
        **d,
        blinds_lines=lines,
        payment_entries=payment_entries,
        attachments=attachments,
    )


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
    est_id = (body.estimate_id or "").strip() or None
    cust_id: str | None = (body.customer_id or "").strip() or None

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
                SELECT
                  e.customer_id,
                  e.prospect_name,
                  e.prospect_surname,
                  e.prospect_phone,
                  e.prospect_email,
                  e.prospect_address,
                  se.builtin_kind AS st,
                  COALESCE(e.is_deleted, FALSE) AS is_deleted
                FROM estimate e
                LEFT JOIN status_estimate se ON se.id = e.status_esti_id
                WHERE e.company_id = CAST(:cid AS uuid) AND e.id = :eid
                LIMIT 1
                """
            ),
            {"cid": str(cid), "eid": est_id},
        ).mappings().first()
        if not er:
            raise HTTPException(status_code=400, detail="Invalid estimate.")
        if er["is_deleted"]:
            raise HTTPException(status_code=400, detail="Estimate is deleted.")
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
        cust_id = _resolve_customer_for_estimate_order(
            db,
            cid,
            est_id,
            body.customer_id,
            estimate_row=dict(er),
        )
    else:
        if not cust_id:
            raise HTTPException(status_code=400, detail="Invalid or inactive customer.")
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

    status_ord = _ensure_default_order_status_id(db, company_id=cid)
    down = body.downpayment
    rate_pct = _company_tax_rate_percent(db, cid)
    tax_amt = _tax_amount_from_base(body.tax_uygulanacak_miktar, rate_pct)

    lines = _normalize_blinds_lines(body.blinds_lines or [])
    if not lines:
        raise HTTPException(status_code=400, detail="Choose at least one blinds type.")
    validate_blinds_lines_categories(db, cid, lines)
    total_amount: Decimal | None = _sum_blinds_line_amounts(lines)
    balance: Decimal | None = _order_balance(total_amount, down, tax_amt, None)

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
              o.status_orde_id,
              o.total_amount,
              o.downpayment,
              o.final_payment,
              o.tax_amount,
              o.agree_data,
              o.installation_scheduled_start_at,
              o.installation_scheduled_end_at
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
    final_status_ord_id: str | None = (cur.get("status_orde_id") or "").strip() or None
    final_inst_start: Any = cur.get("installation_scheduled_start_at")
    final_inst_end: Any = cur.get("installation_scheduled_end_at")

    eff_total: Any = cur.get("total_amount")
    eff_down: Any = cur.get("downpayment")
    eff_tax: Any = cur.get("tax_amount")
    eff_fp: Any = cur.get("final_payment")

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
            final_status_ord_id = None
        else:
            sid = str(sid_raw).strip()
            ok = db.execute(
                text(
                    """
                    SELECT 1
                    FROM status_order so
                    INNER JOIN company_status_order_matrix m
                      ON m.status_order_id = so.id AND m.company_id = CAST(:cid AS uuid)
                    WHERE so.id = :sid AND so.active IS TRUE
                    LIMIT 1
                    """
                ),
                {"cid": str(cid), "sid": sid},
            ).first()
            if not ok:
                raise HTTPException(status_code=400, detail="Invalid or inactive order status.")
            sets.append("status_orde_id = :status_ord_id")
            params["status_ord_id"] = sid
            final_status_ord_id = sid

    if "installation_scheduled_start_at" in patch_fields:
        inst_s = patch_fields["installation_scheduled_start_at"]
        sets.append("installation_scheduled_start_at = :inst_start")
        params["inst_start"] = inst_s
        final_inst_start = inst_s
    if "installation_scheduled_end_at" in patch_fields:
        inst_e = patch_fields["installation_scheduled_end_at"]
        sets.append("installation_scheduled_end_at = :inst_end")
        params["inst_end"] = inst_e
        final_inst_end = inst_e

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

    if _is_ready_for_install_order_status(db, cid, final_status_ord_id) and final_inst_start is None:
        raise HTTPException(
            status_code=400,
            detail="Installation date and time are required when status is Ready for installation.",
        )

    if "status_code" in patch_fields:
        sets.append("status_code = :sc")
        params["sc"] = patch_fields["status_code"]
    elif _is_ready_for_install_order_status(db, cid, final_status_ord_id) and final_inst_start is not None:
        sets.append("status_code = :auto_sc")
        params["auto_sc"] = "install_scheduled"

    if "order_note" in patch_fields:
        sets.append("order_note = :order_note")
        params["order_note"] = _normalize_order_note(patch_fields.get("order_note"))

    if eff_total is not None and sets:
        sets.append("balance = :balance")
        params["balance"] = _order_balance(eff_total, eff_down, eff_tax, eff_fp)

    if not sets:
        raise HTTPException(status_code=400, detail="No changes submitted.")

    next_sc = (
        (patch_fields["status_code"] if "status_code" in patch_fields else None)
        or cur.get("status_code")
        or ""
    )
    next_sc = str(next_sc).strip()
    if next_sc == "in_production" and not (cur.get("agree_data") or "").strip():
        est_id = (cur.get("estimate_id") or "").strip()
        if est_id:
            pre = db.execute(
                text(
                    f"""
                    SELECT
                      COALESCE(
                        NULLIF(trim(concat_ws(' ', c.name, c.surname)), ''),
                        NULLIF(trim(concat_ws(' ', e.prospect_name, e.prospect_surname)), ''),
                        'Prospect'
                      ) AS customer_display,
                      e.visit_notes,
                      ( {_SQL_BLINDS_SUMMARY} ) AS blinds_summary,
                      e.scheduled_start_at,
                      e.tarih_saat
                    FROM estimate e
                    LEFT JOIN customers c ON c.company_id = e.company_id AND c.id = e.customer_id
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
    try_push_order_installation_to_google_calendar(
        db,
        company_id=cid,
        order_id=oid,
        acting_user_id=current_user.id,
    )
    return get_order(order_id=oid, db=db, current_user=current_user)
