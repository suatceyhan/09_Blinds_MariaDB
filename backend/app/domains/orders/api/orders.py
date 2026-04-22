"""Orders CRUD (list, create) scoped to active company."""

import json
import secrets
from datetime import date, datetime, time, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from app.core.config import settings
from app.core.database import get_db
from app.core.person_names import format_person_name_casing
from app.dependencies.auth import effective_company_id, require_permissions
from app.domains.user.models.users import Users
from app.domains.business_lookups.services.blinds_catalog import (
    load_allowed_category_ids_by_type,
    normalize_blinds_line_category_value,
    validate_blinds_lines_categories,
)
from app.integrations.google_calendar_service import try_push_order_installation_to_google_calendar
from app.domains.settings.api.contract_invoice_docs import (
    _fetch_order_extra_payments_summary,
    render_contract_invoice_pdf,
)
from app.utils.email import send_html_email


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


_DONE_BALANCE_EPS = Decimal("0.005")


def _order_status_name_lower(db: Session, company_id: UUID, status_orde_id: str | None) -> str:
    if not status_orde_id or not str(status_orde_id).strip():
        return ""
    row = db.execute(
        text(
            """
            SELECT lower(trim(so.name)) AS n
            FROM status_order so
            INNER JOIN company_status_order_matrix m
              ON m.status_order_id = so.id AND m.company_id = CAST(:cid AS uuid)
            WHERE so.id = :sid AND so.active IS TRUE
            LIMIT 1
            """
        ),
        {"cid": str(company_id), "sid": str(status_orde_id).strip()},
    ).mappings().first()
    return str(row["n"] or "") if row else ""


def _order_status_name_implies_done(db: Session, company_id: UUID, status_orde_id: str | None) -> bool:
    n = _order_status_name_lower(db, company_id, status_orde_id)
    return "done" in n


def _pick_done_order_status_id(db: Session, company_id: UUID) -> str | None:
    row = db.execute(
        text(
            """
            SELECT so.id::text AS id
            FROM status_order so
            INNER JOIN company_status_order_matrix m
              ON m.status_order_id = so.id AND m.company_id = CAST(:cid AS uuid)
            WHERE so.active IS TRUE AND lower(trim(so.name)) LIKE '%done%'
            ORDER BY so.sort_order ASC, so.name ASC
            LIMIT 1
            """
        ),
        {"cid": str(company_id)},
    ).mappings().first()
    return str(row["id"]) if row else None


def _pick_fallback_order_status_leaving_done(db: Session, company_id: UUID) -> str | None:
    """First matrix status (sort_order) that is not done-like and not cancel-like."""
    rows = db.execute(
        text(
            """
            SELECT so.id::text AS id, lower(trim(so.name)) AS n
            FROM status_order so
            INNER JOIN company_status_order_matrix m
              ON m.status_order_id = so.id AND m.company_id = CAST(:cid AS uuid)
            WHERE so.active IS TRUE
            ORDER BY so.sort_order ASC, so.name ASC
            """
        ),
        {"cid": str(company_id)},
    ).mappings().all()
    for r in rows:
        n = str(r.get("n") or "")
        if "done" in n or "cancel" in n:
            continue
        return str(r["id"])
    return None


def _sync_order_done_status_with_balance(db: Session, company_id: UUID, order_id: str) -> None:
    """Keep Done status and zero balance aligned (list UI + business rule)."""
    oid = order_id.strip()
    row = db.execute(
        text(
            """
            SELECT o.status_orde_id::text AS sid, o.balance
            FROM orders o
            WHERE o.company_id = CAST(:cid AS uuid) AND o.id = :oid AND o.active IS TRUE
            LIMIT 1
            """
        ),
        {"cid": str(company_id), "oid": oid},
    ).mappings().first()
    if not row:
        return
    bal_raw = row.get("balance")
    sid = (row.get("sid") or "").strip() or None
    if bal_raw is None:
        return
    bal_d = Decimal(str(bal_raw)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    is_done = _order_status_name_implies_done(db, company_id, sid)
    zero = abs(bal_d) <= _DONE_BALANCE_EPS

    if zero and not is_done:
        done_id = _pick_done_order_status_id(db, company_id)
        if done_id:
            db.execute(
                text(
                    """
                    UPDATE orders
                    SET status_orde_id = :nsid, updated_at = NOW()
                    WHERE company_id = CAST(:cid AS uuid) AND id = :oid AND active IS TRUE
                    """
                ),
                {"cid": str(company_id), "oid": oid, "nsid": done_id},
            )
    elif not zero and is_done:
        # Workflow: fully-paid Done → removing payments should return to Ready for installation,
        # not the first matrix row (often "New order").
        fb = _ready_for_install_order_status_id(db, company_id) or _pick_fallback_order_status_leaving_done(
            db, company_id
        )
        if fb:
            db.execute(
                text(
                    """
                    UPDATE orders
                    SET status_orde_id = :nsid, updated_at = NOW()
                    WHERE company_id = CAST(:cid AS uuid) AND id = :oid AND active IS TRUE
                    """
                ),
                {"cid": str(company_id), "oid": oid, "nsid": fb},
            )


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


def _job_remaining_balance_sum(db: Session, cid: UUID, anchor_order_id: str) -> Decimal:
    """Sum of `orders.balance` for the anchor row and active child orders (`parent_order_id`).

    Matches JOB TOTALS remaining obligation: installments posted on the anchor reduce the anchor
    balance while additionals keep their own balance until conceptually covered by the same pool.
    """
    q = Decimal("0.01")
    aid = anchor_order_id.strip()
    row = db.execute(
        text(
            """
            SELECT COALESCE(SUM(COALESCE(o.balance, 0)), 0) AS s
            FROM orders o
            WHERE o.company_id = CAST(:cid AS uuid)
              AND o.active IS TRUE
              AND (o.id = :aid OR o.parent_order_id = :aid)
            """
        ),
        {"cid": str(cid), "aid": aid},
    ).mappings().first()
    return Decimal(str(row["s"] if row else 0)).quantize(q, rounding=ROUND_HALF_UP)


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
    _sync_order_done_status_with_balance(db, cid, oid)


def _rebalance_job_overpayments(db: Session, cid: UUID, anchor_order_id: str) -> bool:
    """Move recorded payments forward so no job row is overpaid while later rows remain unpaid.

    This keeps per-row `balance` non-negative (within epsilon) by transferring payment entries
    from earlier rows to later rows, preserving entry timestamps where possible.
    """
    q = Decimal("0.01")
    eps = _DONE_BALANCE_EPS
    aid = anchor_order_id.strip()

    # Fetch the job rows in display/payment order: anchor first, then additions by created_at.
    rows = db.execute(
        text(
            """
            SELECT o.id::text AS id, o.created_at, COALESCE(o.balance, 0) AS balance
            FROM orders o
            WHERE o.company_id = CAST(:cid AS uuid)
              AND o.active IS TRUE
              AND (o.id = :aid OR o.parent_order_id = :aid)
            ORDER BY CASE WHEN o.id = :aid THEN 0 ELSE 1 END, o.created_at ASC NULLS LAST
            """
        ),
        {"cid": str(cid), "aid": aid},
    ).mappings().all()
    if not rows or str(rows[0].get("id") or "") != aid:
        return False

    # Materialize balances (quantized) so we can simulate transfers.
    job = [
        {"id": str(r["id"]), "balance": Decimal(str(r.get("balance") or 0)).quantize(q, rounding=ROUND_HALF_UP)}
        for r in rows
    ]

    any_change = False

    # Helper: move up to `amt` from src order entries to dst order entries.
    def _transfer(src_oid: str, dst_oid: str, amt: Decimal) -> Decimal:
        nonlocal any_change
        remaining = amt
        if remaining <= 0:
            return Decimal("0.00")
        # Work from newest entries first (typical user expectation when rebalancing).
        entries = db.execute(
            text(
                """
                SELECT id::text AS id, amount, created_at
                FROM order_payment_entries
                WHERE company_id = CAST(:cid AS uuid) AND order_id = :oid
                  AND COALESCE(is_deleted, FALSE) = FALSE
                ORDER BY created_at DESC, id DESC
                """
            ),
            {"cid": str(cid), "oid": src_oid},
        ).mappings().all()
        for e in entries:
            if remaining <= eps:
                break
            eid = str(e["id"])
            eamt = Decimal(str(e.get("amount") or 0)).quantize(q, rounding=ROUND_HALF_UP)
            if eamt <= 0:
                continue
            moved = min(eamt, remaining).quantize(q, rounding=ROUND_HALF_UP)
            left = (eamt - moved).quantize(q, rounding=ROUND_HALF_UP)

            # Delete the original row and re-insert split parts.
            db.execute(
                text(
                    """
                    UPDATE order_payment_entries
                    SET is_deleted = TRUE
                    WHERE company_id = CAST(:cid AS uuid) AND id = CAST(:eid AS uuid)
                      AND COALESCE(is_deleted, FALSE) = FALSE
                    """
                ),
                {"cid": str(cid), "eid": eid},
            )
            paid_at = e.get("created_at")
            if left > eps:
                db.execute(
                    text(
                        """
                        INSERT INTO order_payment_entries (company_id, order_id, amount, created_at)
                        VALUES (CAST(:cid AS uuid), :oid, :amt, :paid_at)
                        """
                    ),
                    {"cid": str(cid), "oid": src_oid, "amt": left, "paid_at": paid_at},
                )
            if moved > eps:
                db.execute(
                    text(
                        """
                        INSERT INTO order_payment_entries (company_id, order_id, amount, created_at)
                        VALUES (CAST(:cid AS uuid), :oid, :amt, :paid_at)
                        """
                    ),
                    {"cid": str(cid), "oid": dst_oid, "amt": moved, "paid_at": paid_at},
                )
            remaining = (remaining - moved).quantize(q, rounding=ROUND_HALF_UP)
            any_change = True
        return (amt - remaining).quantize(q, rounding=ROUND_HALF_UP)

    # Walk the job rows, pushing credits (negative balances) forward.
    for i in range(len(job) - 1):
        src = job[i]
        src_bal = src["balance"]
        if src_bal >= -eps:
            continue
        credit = (-src_bal).quantize(q, rounding=ROUND_HALF_UP)
        if credit <= eps:
            continue
        for j in range(i + 1, len(job)):
            dst = job[j]
            dst_bal = dst["balance"]
            if dst_bal <= eps:
                continue
            take = min(credit, dst_bal).quantize(q, rounding=ROUND_HALF_UP)
            moved = _transfer(src["id"], dst["id"], take)
            if moved > eps:
                # Moving payment off src increases its balance; moving onto dst decreases its balance.
                src["balance"] = (src["balance"] + moved).quantize(q, rounding=ROUND_HALF_UP)
                dst["balance"] = (dst["balance"] - moved).quantize(q, rounding=ROUND_HALF_UP)
                credit = (credit - moved).quantize(q, rounding=ROUND_HALF_UP)
            if credit <= eps:
                break

    if any_change:
        for r in job:
            _sync_order_final_payment_from_entries(db, cid, r["id"])
    return any_change


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
    JOIN blinds_type bt ON bt.id = eb.blinds_id
    WHERE eb.company_id = e.company_id AND eb.estimate_id = e.id
  ),
  (
    SELECT CASE
      WHEN e.perde_sayisi IS NOT NULL THEN bt.name || ' (' || e.perde_sayisi::text || ')'
      ELSE bt.name
    END
    FROM blinds_type bt
    WHERE bt.id = e.blinds_id
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
    JOIN blinds_type bt ON bt.id = eb.blinds_id
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
    WHERE bt2.id = e.blinds_id
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
            WHERE so.active IS TRUE
              AND lower(trim(so.name)) LIKE '%ready%'
              AND lower(trim(so.name)) LIKE '%install%'
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


def _order_status_label_implies_cancelled(db: Session, company_id: UUID, status_orde_id: str | None) -> bool:
    """Heuristic aligned with orders list styling: label contains 'cancel' (e.g. Cancelled)."""
    if not status_orde_id or not str(status_orde_id).strip():
        return False
    row = db.execute(
        text(
            """
            SELECT lower(trim(so.name)) AS n
            FROM status_order so
            INNER JOIN company_status_order_matrix m
              ON m.status_order_id = so.id AND m.company_id = CAST(:cid AS uuid)
            WHERE so.id = :sid AND so.active IS TRUE
            LIMIT 1
            """
        ),
        {"cid": str(company_id), "sid": str(status_orde_id).strip()},
    ).mappings().first()
    if not row:
        return False
    return "cancel" in (row.get("n") or "")


def _builtin_estimate_status_id(db: Session, company_id: UUID, builtin_kind: str) -> str | None:
    row = db.execute(
        text(
            """
            SELECT se.id
            FROM status_estimate se
            INNER JOIN company_status_estimate_matrix m
              ON m.status_estimate_id = se.id AND m.company_id = CAST(:cid AS uuid)
            WHERE se.builtin_kind = :bk AND se.active IS TRUE
            LIMIT 1
            """
        ),
        {"cid": str(company_id), "bk": builtin_kind},
    ).mappings().first()
    return str(row["id"]) if row else None


def _sync_linked_estimate_to_cancelled(db: Session, company_id: UUID, estimate_id: str | None) -> None:
    eid = (estimate_id or "").strip()
    if not eid:
        return
    sid = _builtin_estimate_status_id(db, company_id, "cancelled")
    if not sid:
        return
    db.execute(
        text(
            """
            UPDATE estimate
            SET status_esti_id = :sid, updated_at = NOW()
            WHERE company_id = CAST(:cid AS uuid) AND id = :eid AND is_deleted IS NOT TRUE
            """
        ),
        {"cid": str(company_id), "eid": eid, "sid": sid},
    )


def _sync_linked_estimate_to_converted_after_order_uncancel(
    db: Session, company_id: UUID, estimate_id: str | None
) -> None:
    """When an order is restored or moved off a cancelled status, set estimate back to Converted if it was Cancelled."""
    eid = (estimate_id or "").strip()
    if not eid:
        return
    conv = _builtin_estimate_status_id(db, company_id, "converted")
    if not conv:
        return
    db.execute(
        text(
            """
            UPDATE estimate e
            SET status_esti_id = :conv, updated_at = NOW()
            WHERE e.company_id = CAST(:cid AS uuid)
              AND e.id = :eid
              AND e.is_deleted IS NOT TRUE
              AND EXISTS (
                SELECT 1 FROM status_estimate se
                WHERE se.id = e.status_esti_id AND se.builtin_kind = 'cancelled'
              )
            """
        ),
        {"cid": str(company_id), "eid": eid, "conv": conv},
    )


def _insert_customer_from_prospect_and_link_estimate(
    db: Session,
    company_id: UUID,
    estimate_id: str,
    est: dict[str, Any],
) -> str:
    name = format_person_name_casing((est.get("prospect_name") or "").strip() or None) or ""
    if not name:
        raise HTTPException(
            status_code=400,
            detail="This estimate has no customer record yet. Add prospect name on the estimate before creating an order.",
        )
    surname = format_person_name_casing((est.get("prospect_surname") or "").strip() or None)
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
    expense_total: Decimal | None = None
    status_code: str
    status_orde_id: str | None = None
    status_order_label: str | None = None
    agreement_date: date | None = None
    created_at: Any | None = None
    active: bool = True
    installation_scheduled_start_at: datetime | None = None


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
    blinds_type_id: str | None = None


class OrderPaymentEntryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    order_id: str | None = None
    amount: Decimal
    paid_at: datetime
    payment_group_id: str | None = None


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


def _money_q(v: Any) -> Decimal:
    q = Decimal("0.01")
    return Decimal(str(v or 0)).quantize(q, rounding=ROUND_HALF_UP)


class OrderFinancialTotalsOut(BaseModel):
    """Roll-up for the order summary card (anchor order + line-item additions)."""

    subtotal_ex_tax: Decimal | None = None
    tax_amount: Decimal | None = None
    taxable_base: Decimal | None = None
    downpayment: Decimal | None = None
    paid_total: Decimal | None = None
    balance: Decimal | None = None


class OrderLineItemAdditionOut(BaseModel):
    """One appended blinds job linked to an anchor order (`parent_order_id`)."""

    order_id: str
    created_at: Any | None = None
    subtotal_ex_tax: Decimal | None = None
    tax_amount: Decimal | None = None
    taxable_base: Decimal | None = None
    downpayment: Decimal | None = None
    paid_total: Decimal | None = None
    balance: Decimal | None = None
    status_order_label: str | None = None


def _rollup_financial_totals(rows: list[dict[str, Any]]) -> OrderFinancialTotalsOut:
    q = Decimal("0.01")
    sub = Decimal("0")
    tax = Decimal("0")
    tb = Decimal("0")
    dow = Decimal("0")
    paid = Decimal("0")
    bal = Decimal("0")
    for r in rows:
        sub += _money_q(r.get("total_amount"))
        tax += _money_q(r.get("tax_amount"))
        tb += _money_q(r.get("tax_uygulanacak_miktar"))
        dow += _money_q(r.get("downpayment"))
        paid += _money_q(r.get("downpayment")) + _money_q(r.get("final_payment"))
        bal += _money_q(r.get("balance"))
    return OrderFinancialTotalsOut(
        subtotal_ex_tax=sub.quantize(q),
        tax_amount=tax.quantize(q),
        taxable_base=tb.quantize(q),
        downpayment=dow.quantize(q),
        paid_total=paid.quantize(q),
        balance=bal.quantize(q),
    )


def _build_payment_entries_for_detail(
    order_id: str | None,
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
                order_id=order_id,
                amount=down_d,
                paid_at=_down_payment_paid_at(agreement_date, created_at),
                payment_group_id=None,
            )
        )
    for pr in pay_rows:
        d = dict(pr)
        # When callers SELECT order_id (job aggregation), avoid passing it twice.
        d.pop("order_id", None)
        # We send group id separately for optional UI grouping.
        pgid = d.pop("payment_group_id", None)
        if pgid is not None:
            pgid = str(pgid)
        out.append(OrderPaymentEntryOut(order_id=order_id, **d))
        if pgid:
            out[-1].payment_group_id = pgid
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
              AND kind IN ('photo', 'excel')
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
            blinds_type_id=None,
        )
        for r in rows
    ]


_ATT_HAS_BLINDS_TYPE_COL_CACHE_KEY = "orders_att_has_blinds_type_id"


def _order_attachments_has_blinds_type_id(db: Session) -> bool:
    cached = db.info.get(_ATT_HAS_BLINDS_TYPE_COL_CACHE_KEY)
    if cached is not None:
        return bool(cached)
    exists = db.execute(
        text(
            """
            SELECT EXISTS (
              SELECT 1
              FROM information_schema.columns
              WHERE table_catalog = current_database()
                AND table_name = 'order_attachments'
                AND column_name = 'blinds_type_id'
            )
            """
        )
    ).scalar()
    db.info[_ATT_HAS_BLINDS_TYPE_COL_CACHE_KEY] = bool(exists)
    return bool(exists)


def _fetch_order_line_photos(
    db: Session,
    cid: UUID,
    oid: str,
) -> dict[str, list[OrderAttachmentOut]]:
    """Per-line photos keyed by blinds_type_id. Returns {} if migration hasn't added the column yet."""
    if not _order_attachments_has_blinds_type_id(db):
        return {}
    rows = db.execute(
        text(
            """
            SELECT
              id::text AS id,
              kind,
              original_filename,
              stored_relpath,
              created_at,
              trim(COALESCE(blinds_type_id::text,'')) AS blinds_type_id
            FROM order_attachments
            WHERE company_id = CAST(:cid AS uuid) AND order_id = :oid
              AND COALESCE(is_deleted, FALSE) = FALSE
              AND kind = 'line_photo'
              AND blinds_type_id IS NOT NULL
            ORDER BY created_at DESC
            """
        ),
        {"cid": str(cid), "oid": oid},
    ).mappings().all()
    out: dict[str, list[OrderAttachmentOut]] = {}
    for r in rows:
        bt = str(r.get("blinds_type_id") or "").strip()
        if not bt:
            continue
        out.setdefault(bt, []).append(
            OrderAttachmentOut(
                id=str(r["id"]),
                kind=str(r["kind"]),
                filename=str(r["original_filename"]),
                url=f"/uploads/{r['stored_relpath']}",
                created_at=r["created_at"],
                blinds_type_id=bt,
            )
        )
    return out


def _fetch_order_expense_entries(db: Session, cid: UUID, oid: str) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            """
            SELECT id::text AS id, amount, note, spent_at, created_at
            FROM order_expense_entries
            WHERE company_id = CAST(:cid AS uuid) AND order_id = :oid
              AND COALESCE(is_deleted, FALSE) = FALSE
            ORDER BY COALESCE(spent_at, created_at) DESC, created_at DESC
            """
        ),
        {"cid": str(cid), "oid": oid},
    ).mappings().all()
    out: list[dict[str, Any]] = []
    for r in rows:
        out.append(
            {
                "id": str(r["id"]),
                "amount": _money_q(r.get("amount")),
                "note": (str(r.get("note") or "").strip() or None),
                "spent_at": r.get("spent_at"),
                "created_at": r.get("created_at"),
            }
        )
    return out


def _sum_expenses_for_job(db: Session, cid: UUID, anchor_order_id: str) -> Decimal:
    q = Decimal("0.01")
    aid = anchor_order_id.strip()
    row = db.execute(
        text(
            """
            SELECT COALESCE(SUM(e.amount), 0) AS s
            FROM order_expense_entries e
            INNER JOIN orders o
              ON o.company_id = e.company_id AND o.id = e.order_id
            WHERE e.company_id = CAST(:cid AS uuid)
              AND COALESCE(e.is_deleted, FALSE) = FALSE
              AND o.active IS TRUE
              AND (o.id = :aid OR o.parent_order_id = :aid)
            """
        ),
        {"cid": str(cid), "aid": aid},
    ).mappings().first()
    return Decimal(str(row["s"] if row else 0)).quantize(q, rounding=ROUND_HALF_UP)


def _sum_expenses_for_order(db: Session, cid: UUID, order_id: str) -> Decimal:
    q = Decimal("0.01")
    oid = order_id.strip()
    row = db.execute(
        text(
            """
            SELECT COALESCE(SUM(amount), 0) AS s
            FROM order_expense_entries
            WHERE company_id = CAST(:cid AS uuid) AND order_id = :oid
              AND COALESCE(is_deleted, FALSE) = FALSE
            """
        ),
        {"cid": str(cid), "oid": oid},
    ).mappings().first()
    return Decimal(str(row["s"] if row else 0)).quantize(q, rounding=ROUND_HALF_UP)


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
    expense_total: Decimal | None = None
    profit: Decimal | None = None
    expense_entries: list[dict[str, Any]] = Field(default_factory=list)
    attachments: list[OrderAttachmentOut] = Field(default_factory=list)
    line_photos: dict[str, list[OrderAttachmentOut]] = Field(default_factory=dict)
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
    parent_order_id: str | None = None
    financial_totals: OrderFinancialTotalsOut
    has_line_item_additions: bool = False
    line_item_additions: list[OrderLineItemAdditionOut] = Field(default_factory=list)


class OrderLineItemAdditionCreateIn(BaseModel):
    """Create a child order linked to an anchor (same customer; tax rate from company)."""

    tax_uygulanacak_miktar: Decimal | None = None
    downpayment: Decimal | None = None
    agreement_date: date | None = None
    blinds_lines: list[dict[str, Any]] = Field(default_factory=list)
    order_note: str | None = Field(None, max_length=4000)


class OrderRecordPaymentIn(BaseModel):
    amount: Decimal = Field(..., gt=0)


class OrderExpenseCreateIn(BaseModel):
    amount: Decimal = Field(..., gt=0)
    note: str | None = Field(None, max_length=4000)
    spent_at: datetime | None = None


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
            SELECT bt.id, bt.name
            FROM blinds_type bt
            INNER JOIN company_blinds_type_matrix m
              ON m.blinds_type_id = bt.id AND m.company_id = CAST(:cid AS uuid)
            WHERE bt.active IS TRUE
            ORDER BY bt.sort_order ASC, bt.name ASC
            """
        ),
        {"cid": str(cid)},
    ).mappings().all()
    cats = db.execute(
        text(
            """
            SELECT pc.code AS id, pc.name, pc.sort_order
            FROM blinds_product_category pc
            INNER JOIN company_blinds_product_category_matrix m
              ON m.category_code = pc.code AND m.company_id = CAST(:cid AS uuid)
            WHERE pc.active IS TRUE
            ORDER BY pc.sort_order ASC, pc.name ASC
            """
        ),
        {"cid": str(cid)},
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
              COALESCE(o.total_amount, 0) + COALESCE(ch.total_amount, 0) AS total_amount,
              COALESCE(o.downpayment, 0) + COALESCE(ch.downpayment, 0) AS downpayment,
              COALESCE(o.final_payment, 0) + COALESCE(ch.final_payment, 0) AS final_payment,
              COALESCE(o.balance, 0) + COALESCE(ch.balance, 0) AS balance,
              COALESCE(o.tax_uygulanacak_miktar, 0) + COALESCE(ch.tax_uygulanacak_miktar, 0) AS tax_uygulanacak_miktar,
              COALESCE(o.tax_amount, 0) + COALESCE(ch.tax_amount, 0) AS tax_amount,
              COALESCE(ex.expense_total, 0) AS expense_total,
              o.status_code,
              o.status_orde_id,
              so.name AS status_order_label,
              o.agreement_date,
              o.created_at,
              o.active,
              o.installation_scheduled_start_at
            FROM orders o
            JOIN customers c ON c.company_id = o.company_id AND c.id = o.customer_id
            LEFT JOIN status_order so ON so.id = o.status_orde_id
            LEFT JOIN (
              SELECT
                o2.company_id,
                o2.parent_order_id,
                COALESCE(SUM(o2.total_amount), 0) AS total_amount,
                COALESCE(SUM(o2.downpayment), 0) AS downpayment,
                COALESCE(SUM(o2.final_payment), 0) AS final_payment,
                COALESCE(SUM(o2.balance), 0) AS balance,
                COALESCE(SUM(o2.tax_uygulanacak_miktar), 0) AS tax_uygulanacak_miktar,
                COALESCE(SUM(o2.tax_amount), 0) AS tax_amount
              FROM orders o2
              WHERE o2.company_id = CAST(:cid AS uuid)
                AND o2.parent_order_id IS NOT NULL
                AND (CASE WHEN :include_deleted THEN TRUE ELSE o2.active IS TRUE END)
              GROUP BY o2.company_id, o2.parent_order_id
            ) ch ON ch.company_id = o.company_id AND ch.parent_order_id = o.id
            LEFT JOIN (
              SELECT
                o3.company_id,
                COALESCE(o3.parent_order_id, o3.id) AS anchor_id,
                COALESCE(SUM(e.amount), 0) AS expense_total
              FROM orders o3
              INNER JOIN order_expense_entries e
                ON e.company_id = o3.company_id AND e.order_id = o3.id AND COALESCE(e.is_deleted, FALSE) = FALSE
              WHERE o3.company_id = CAST(:cid AS uuid)
                AND (CASE WHEN :include_deleted THEN TRUE ELSE o3.active IS TRUE END)
              GROUP BY o3.company_id, COALESCE(o3.parent_order_id, o3.id)
            ) ex ON ex.company_id = o.company_id AND ex.anchor_id = o.id
            WHERE {w}
              AND (o.parent_order_id IS NULL)
            ORDER BY o.created_at DESC NULLS LAST
            LIMIT :limit
            """
        ),
        {**params, "include_deleted": include_deleted},
    ).mappings().all()
    return [OrderListItemOut(**dict(r)) for r in rows]


def _financial_row_for_rollup(m: dict[str, Any]) -> dict[str, Any]:
    return {
        "total_amount": m.get("total_amount"),
        "tax_amount": m.get("tax_amount"),
        "tax_uygulanacak_miktar": m.get("tax_uygulanacak_miktar"),
        "downpayment": m.get("downpayment"),
        "final_payment": m.get("final_payment"),
        "balance": m.get("balance"),
    }


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
              o.active,
              NULLIF(trim(o.parent_order_id::text), '') AS parent_order_id
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
    parent_ref = (str(row.get("parent_order_id") or "")).strip() or None
    anchor_oid = parent_ref if parent_ref else oid

    # Fix historic overpayments on earlier rows by moving payment entries forward.
    # This prevents negative balances like "-125.25" on the original when additions still owe money.
    if _rebalance_job_overpayments(db, cid, anchor_oid):
        db.commit()

    job_rem = _job_remaining_balance_sum(db, cid, anchor_oid)
    # Cap additional installments by rolled-up job remaining (not only this row's balance).
    effective_cap = job_rem if job_rem > _DONE_BALANCE_EPS else Decimal("0").quantize(q)
    if pay_amt > effective_cap:
        raise HTTPException(
            status_code=400,
            detail="Payment exceeds remaining job balance.",
        )

    # Waterfall allocation: original order first, then additions by created_at.
    group_id = str(uuid4())
    paid_at = datetime.now(timezone.utc)
    job_rows = db.execute(
        text(
            """
            SELECT o.id::text AS id, COALESCE(o.balance, 0) AS balance, o.created_at
            FROM orders o
            WHERE o.company_id = CAST(:cid AS uuid)
              AND o.active IS TRUE
              AND (o.id = :aid OR o.parent_order_id = :aid)
            ORDER BY CASE WHEN o.id = :aid THEN 0 ELSE 1 END, o.created_at ASC NULLS LAST
            """
        ),
        {"cid": str(cid), "aid": anchor_oid},
    ).mappings().all()

    remaining = pay_amt
    touched: set[str] = set()
    for r in job_rows:
        if remaining <= _DONE_BALANCE_EPS:
            break
        rid = str(r["id"])
        bal = Decimal(str(r.get("balance") or 0)).quantize(q, rounding=ROUND_HALF_UP)
        if bal <= _DONE_BALANCE_EPS:
            continue
        take = min(remaining, bal).quantize(q, rounding=ROUND_HALF_UP)
        if take <= _DONE_BALANCE_EPS:
            continue
        db.execute(
            text(
                """
                INSERT INTO order_payment_entries (company_id, order_id, amount, payment_group_id, created_at)
                VALUES (CAST(:cid AS uuid), :oid, :amt, CAST(:gid AS uuid), :paid_at)
                """
            ),
            {"cid": str(cid), "oid": rid, "amt": take, "gid": group_id, "paid_at": paid_at},
        )
        touched.add(rid)
        remaining = (remaining - take).quantize(q, rounding=ROUND_HALF_UP)

    if remaining > _DONE_BALANCE_EPS:
        raise HTTPException(status_code=400, detail="Payment exceeds remaining job balance.")

    for rid in touched:
        _sync_order_final_payment_from_entries(db, cid, rid)
    db.commit()
    return get_order(order_id=anchor_oid, db=db, current_user=current_user)


@router.post("/{order_id}/expenses", response_model=OrderDetailOut)
def create_order_expense(
    order_id: str,
    body: OrderExpenseCreateIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("orders.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    oid = order_id.strip()
    ok = db.execute(
        text(
            """
            SELECT 1
            FROM orders
            WHERE company_id = CAST(:cid AS uuid) AND id = :oid AND active IS TRUE
            LIMIT 1
            """
        ),
        {"cid": str(cid), "oid": oid},
    ).first()
    if not ok:
        raise HTTPException(status_code=404, detail="Order not found.")

    q = Decimal("0.01")
    amt = Decimal(str(body.amount)).quantize(q, rounding=ROUND_HALF_UP)
    if amt <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive.")
    note = (body.note or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    note = note[:4000] if note else None
    db.execute(
        text(
            """
            INSERT INTO order_expense_entries (company_id, order_id, amount, note, spent_at, created_by_user_id)
            VALUES (CAST(:cid AS uuid), :oid, :amt, :note, :spent_at, :uid)
            """
        ),
        {
            "cid": str(cid),
            "oid": oid,
            "amt": amt,
            "note": note,
            "spent_at": body.spent_at,
            "uid": str(current_user.id),
        },
    )
    db.commit()
    return get_order(order_id=oid, db=db, current_user=current_user)


@router.delete("/{order_id}/expenses/{expense_id}", status_code=status.HTTP_204_NO_CONTENT)
def soft_delete_order_expense(
    order_id: str,
    expense_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("orders.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    oid = order_id.strip()
    try:
        xid = UUID(expense_id.strip())
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Expense not found.") from exc
    res = db.execute(
        text(
            """
            UPDATE order_expense_entries
            SET is_deleted = TRUE
            WHERE company_id = CAST(:cid AS uuid) AND order_id = :oid AND id = CAST(:xid AS uuid)
              AND COALESCE(is_deleted, FALSE) = FALSE
            """
        ),
        {"cid": str(cid), "oid": oid, "xid": str(xid)},
    )
    if res.rowcount == 0:
        raise HTTPException(status_code=404, detail="Expense not found.")
    db.commit()
    return None


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
    eid_raw = (entry_id or "").strip()
    if eid_raw.startswith("grp:"):
        try:
            gid = UUID(eid_raw[4:])
        except ValueError as exc:
            raise HTTPException(status_code=404, detail="Payment entry not found.") from exc
        res = db.execute(
            text(
                """
                UPDATE order_payment_entries
                SET is_deleted = TRUE
                WHERE company_id = CAST(:cid AS uuid)
                  AND payment_group_id = CAST(:gid AS uuid)
                  AND COALESCE(is_deleted, FALSE) = FALSE
                """
            ),
            {"cid": str(cid), "gid": str(gid)},
        )
    else:
        try:
            eid = UUID(eid_raw)
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


@router.post("/{order_id}/line-photos", response_model=OrderDetailOut)
async def upload_order_line_photo(
    order_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("orders.edit"))],
    blinds_type_id: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
):
    """Upload a per-blinds-line photo (fabric reference)."""
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    oid = order_id.strip()
    bt = (blinds_type_id or "").strip()
    if not bt:
        raise HTTPException(status_code=400, detail="blinds_type_id is required.")
    if not _order_attachments_has_blinds_type_id(db):
        raise HTTPException(
            status_code=503,
            detail="Database migration required: run SQL from DB/38_order_line_photos.sql.",
        )

    row = db.execute(
        text(
            """
            SELECT o.blinds_lines AS blinds_lines_json
            FROM orders o
            WHERE o.company_id = CAST(:cid AS uuid) AND o.id = :oid AND o.active IS TRUE
            LIMIT 1
            """
        ),
        {"cid": str(cid), "oid": oid},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Order not found.")
    lines = _normalize_blinds_lines(row.get("blinds_lines_json"))
    if not any(str(x.get("id") or "").strip() == bt for x in lines):
        raise HTTPException(status_code=400, detail="This blinds type is not selected on the order.")

    ct = _normalize_upload_content_type(file.content_type)
    fn_low = (file.filename or "").lower()
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
    data = await file.read()
    if len(data) > ORDER_PHOTO_MAX_BYTES:
        raise HTTPException(status_code=400, detail="File too large.")

    safe = _safe_upload_basename(file.filename or f"upload{ext}")
    unique = f"{uuid4().hex}_{safe}"
    if not unique.lower().endswith(ext.lower()):
        unique = f"{unique}{ext}"

    dest_dir = _orders_upload_dir(cid, oid) / "line_photos" / bt
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / unique
    rel = Path("orders") / str(cid) / oid / "line_photos" / bt / unique
    stored_relpath = rel.as_posix()
    dest_path.write_bytes(data)

    db.execute(
        text(
            """
            INSERT INTO order_attachments (
              company_id, order_id, kind, blinds_type_id,
              original_filename, stored_relpath, content_type, file_size
            )
            VALUES (
              CAST(:cid AS uuid), :oid, 'line_photo', :bt,
              :oname, :spath, :ct, :fsz
            )
            """
        ),
        {
            "cid": str(cid),
            "oid": oid,
            "bt": bt,
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
              o.parent_order_id,
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
    parent_ref = (str(d.pop("parent_order_id", None) or "")).strip() or None
    lines = _normalize_blinds_lines(d.pop("blinds_lines_json", None))

    rollup_source: list[dict[str, Any]] = [_financial_row_for_rollup(d)]
    line_item_additions: list[OrderLineItemAdditionOut] = []
    if not parent_ref:
        # Keep job rows consistent: if the original row is overpaid while additions still owe money,
        # move payments forward so balances don't go negative in the UI.
        if _rebalance_job_overpayments(db, cid, oid):
            db.commit()
            # Reload the anchor row after rebalancing.
            row2 = db.execute(
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
                      o.parent_order_id,
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
            if row2:
                d = dict(row2)
                parent_ref = (str(d.pop("parent_order_id", None) or "")).strip() or None
                lines = _normalize_blinds_lines(d.pop("blinds_lines_json", None))
                rollup_source = [_financial_row_for_rollup(d)]

        child_rows = db.execute(
            text(
                """
                SELECT
                  o.id::text AS id,
                  o.created_at,
                  o.total_amount,
                  o.tax_amount,
                  o.tax_uygulanacak_miktar,
                  o.downpayment,
                  o.final_payment,
                  o.balance,
                  trim(so.name) AS status_order_label
                FROM orders o
                LEFT JOIN status_order so ON so.id = o.status_orde_id
                WHERE o.company_id = CAST(:cid AS uuid)
                  AND o.parent_order_id = :pid
                  AND o.active IS TRUE
                ORDER BY o.created_at ASC NULLS LAST
                """
            ),
            {"cid": str(cid), "pid": oid},
        ).mappings().all()
        for cr in child_rows:
            crd = dict(cr)
            rollup_source.append(_financial_row_for_rollup(crd))
            paid_row = _money_q(crd.get("downpayment")) + _money_q(crd.get("final_payment"))
            line_item_additions.append(
                OrderLineItemAdditionOut(
                    order_id=str(crd["id"]),
                    created_at=crd.get("created_at"),
                    subtotal_ex_tax=_money_q(crd.get("total_amount")),
                    tax_amount=_money_q(crd.get("tax_amount")),
                    taxable_base=_money_q(crd.get("tax_uygulanacak_miktar")),
                    downpayment=_money_q(crd.get("downpayment")),
                    paid_total=paid_row,
                    balance=_money_q(crd.get("balance")),
                    status_order_label=str(crd.get("status_order_label") or "").strip() or None,
                )
            )
    financial_totals = _rollup_financial_totals(rollup_source)
    # Expenses are always stored per-order, but the anchor job view should roll them up.
    expense_total = _sum_expenses_for_job(db, cid, oid) if not parent_ref else _sum_expenses_for_order(db, cid, oid)

    total_incl_tax = _money_q(financial_totals.subtotal_ex_tax) + _money_q(financial_totals.tax_amount)
    profit = (total_incl_tax - _money_q(expense_total)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    payment_entries: list[OrderPaymentEntryOut] = []
    if not parent_ref:
        job_rows = db.execute(
            text(
                """
                SELECT o.id::text AS oid, o.downpayment, o.agreement_date, o.created_at
                FROM orders o
                WHERE o.company_id = CAST(:cid AS uuid)
                  AND o.active IS TRUE
                  AND (o.id = :aid OR o.parent_order_id = :aid)
                ORDER BY CASE WHEN o.id = :aid THEN 0 ELSE 1 END, o.created_at ASC NULLS LAST
                """
            ),
            {"cid": str(cid), "aid": oid},
        ).mappings().all()
        oids = [str(r["oid"]) for r in job_rows]
        pay_all = (
            db.execute(
                text(
                    """
                    SELECT
                      id::text AS id,
                      order_id::text AS order_id,
                      amount,
                      created_at AS paid_at,
                      payment_group_id::text AS payment_group_id
                    FROM order_payment_entries
                    WHERE company_id = CAST(:cid AS uuid)
                      AND order_id = ANY(:oids)
                      AND COALESCE(is_deleted, FALSE) = FALSE
                    ORDER BY created_at ASC
                    """
                ),
                {"cid": str(cid), "oids": oids},
            ).mappings().all()
            if oids
            else []
        )
        grouped: dict[str, list[dict[str, Any]]] = {}
        for pr in pay_all:
            grouped.setdefault(str(pr.get("order_id") or ""), []).append(dict(pr))
        for r in job_rows:
            joid = str(r["oid"])
            payment_entries.extend(
                _build_payment_entries_for_detail(
                    joid,
                    r.get("downpayment"),
                    r.get("agreement_date"),
                    r.get("created_at"),
                    grouped.get(joid, []),
                )
            )
        # Collapse waterfall-split entries back into one row per user "record payment" action.
        collapsed: list[OrderPaymentEntryOut] = []
        grp_map: dict[str, list[OrderPaymentEntryOut]] = {}
        for e in payment_entries:
            if e.id == "downpayment" or not e.payment_group_id:
                collapsed.append(e)
                continue
            grp_map.setdefault(e.payment_group_id, []).append(e)
        for gid, entries in grp_map.items():
            amt = sum((x.amount for x in entries), Decimal("0.00"))
            paid_at = min((x.paid_at for x in entries))
            collapsed.append(
                OrderPaymentEntryOut(
                    id=f"grp:{gid}",
                    order_id=None,
                    amount=amt.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP),
                    paid_at=paid_at,
                    payment_group_id=gid,
                )
            )
        payment_entries = collapsed
        payment_entries.sort(key=lambda e: (e.paid_at, 0 if e.id == "downpayment" else 1))
    else:
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
            oid,
            d.get("downpayment"),
            d.get("agreement_date"),
            d.get("created_at"),
            list(pay_rows),
        )
    attachments = _fetch_order_attachments(db, cid, oid)
    line_photos = _fetch_order_line_photos(db, cid, oid)
    expense_entries = _fetch_order_expense_entries(db, cid, oid)
    return OrderDetailOut(
        **d,
        blinds_lines=lines,
        payment_entries=payment_entries,
        expense_total=_money_q(expense_total),
        profit=profit,
        expense_entries=expense_entries,
        attachments=attachments,
        line_photos=line_photos,
        parent_order_id=parent_ref,
        financial_totals=financial_totals,
        has_line_item_additions=len(line_item_additions) > 0,
        line_item_additions=line_item_additions,
    )


def _order_invoice_number(order_id: str) -> str:
    return f"INV-{order_id}"


def _order_status_is_done_like(status_label: str | None) -> bool:
    return "done" in (status_label or "").strip().lower()


def _fetch_order_doc_email_context(db: Session, company_id: UUID, order_id: str) -> dict[str, Any] | None:
    row = db.execute(
        text(
            """
            SELECT
              o.id::text AS order_id,
              o.total_amount,
              o.tax_amount,
              o.downpayment,
              o.balance,
              so.name AS status_order_label,
              trim(concat_ws(' ', c.name, c.surname)) AS customer_name,
              c.address AS customer_address,
              c.phone AS customer_phone,
              c.email AS customer_email,
              co.name AS company_name,
              co.address AS company_address,
              co.phone AS company_phone,
              co.email AS company_email
            FROM orders o
            JOIN customers c ON c.company_id = o.company_id AND c.id = o.customer_id
            JOIN companies co ON co.id = o.company_id
            LEFT JOIN status_order so ON so.id = o.status_orde_id
            WHERE o.company_id = CAST(:cid AS uuid) AND o.id = :oid AND o.active IS TRUE
            LIMIT 1
            """
        ),
        {"cid": str(company_id), "oid": order_id},
    ).mappings().first()
    return dict(row) if row else None


@router.get("/{order_id}/documents/final-invoice")
def order_final_invoice_download(
    order_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("orders.view"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    oid = order_id.strip()
    ctx = _fetch_order_doc_email_context(db, cid, oid)
    if not ctx:
        raise HTTPException(status_code=404, detail="Order not found.")
    if not _order_status_is_done_like(ctx.get("status_order_label")):
        raise HTTPException(status_code=400, detail="Final invoice is available only when order status is Done.")

    now = datetime.now(timezone.utc).astimezone()
    inv_no = _order_invoice_number(oid)
    total = (Decimal(str(ctx.get("total_amount") or 0)) + Decimal(str(ctx.get("tax_amount") or 0))).quantize(
        Decimal("0.01")
    )
    down = Decimal(str(ctx.get("downpayment") or 0)).quantize(Decimal("0.01"))
    bal = Decimal(str(ctx.get("balance") or 0)).quantize(Decimal("0.01"))
    paid = abs(bal) <= Decimal("0.01")
    extra_total, extra_cnt = _fetch_order_extra_payments_summary(db, str(cid), oid)
    received_total = (down + extra_total).quantize(Decimal("0.01"))
    paid_to_date = (total - bal).quantize(Decimal("0.01"))

    _subj, pdf = render_contract_invoice_pdf(
        db=db,
        company_id=str(cid),
        kind="final_invoice",
        page_title="Final invoice",
        data={
            "business_name": str(ctx.get("company_name") or "").strip(),
            "business_address": str(ctx.get("company_address") or "").strip(),
            "business_phone": str(ctx.get("company_phone") or "").strip(),
            "business_email": str(ctx.get("company_email") or "").strip(),
            "customer_name": str(ctx.get("customer_name") or "").strip(),
            "customer_address": str(ctx.get("customer_address") or "").strip(),
            "customer_phone": str(ctx.get("customer_phone") or "").strip(),
            "invoice_number": inv_no,
            "invoice_date": now.strftime("%b %d, %Y"),
            "product": "Custom Zebra Blinds",
            "description": "",
            "measurements": "",
            "installation_address": str(ctx.get("customer_address") or "").strip(),
            "total_project_price": f"{total:,.2f}",
            "deposit_paid": f"{down:,.2f}",
            "balance_due": f"{bal:,.2f}",
            "balance_paid": f"{paid_to_date:,.2f}",
            "extra_payments_total": f"{extra_total:,.2f}",
            "extra_payments_count": f"{extra_cnt} payment" + ("s" if extra_cnt != 1 else ""),
            "payments_received_total": f"{received_total:,.2f}",
            "payment_method": "",
            "payment_date": "",
            "status": "PAID" if paid else "DUE",
        },
    )
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename=\"final-invoice-{oid}.pdf\"'},
    )


@router.post("/{order_id}/documents/final-invoice/send-email", status_code=status.HTTP_204_NO_CONTENT)
def order_final_invoice_send_email(
    order_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("orders.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    oid = order_id.strip()
    ctx = _fetch_order_doc_email_context(db, cid, oid)
    if not ctx:
        raise HTTPException(status_code=404, detail="Order not found.")
    if not _order_status_is_done_like(ctx.get("status_order_label")):
        raise HTTPException(status_code=400, detail="Final invoice is available only when order status is Done.")

    to_email = str(ctx.get("customer_email") or "").strip()
    if not to_email:
        raise HTTPException(status_code=400, detail="Customer email is missing for this order.")

    now = datetime.now(timezone.utc).astimezone()
    inv_no = _order_invoice_number(oid)
    total = (Decimal(str(ctx.get("total_amount") or 0)) + Decimal(str(ctx.get("tax_amount") or 0))).quantize(
        Decimal("0.01")
    )
    down = Decimal(str(ctx.get("downpayment") or 0)).quantize(Decimal("0.01"))
    bal = Decimal(str(ctx.get("balance") or 0)).quantize(Decimal("0.01"))
    paid = abs(bal) <= Decimal("0.01")
    extra_total, extra_cnt = _fetch_order_extra_payments_summary(db, str(cid), oid)
    received_total = (down + extra_total).quantize(Decimal("0.01"))
    paid_to_date = (total - bal).quantize(Decimal("0.01"))

    subject, pdf = render_contract_invoice_pdf(
        db=db,
        company_id=str(cid),
        kind="final_invoice",
        page_title="Final invoice",
        data={
            "business_name": str(ctx.get("company_name") or "").strip(),
            "business_address": str(ctx.get("company_address") or "").strip(),
            "business_phone": str(ctx.get("company_phone") or "").strip(),
            "business_email": str(ctx.get("company_email") or "").strip(),
            "customer_name": str(ctx.get("customer_name") or "").strip(),
            "customer_address": str(ctx.get("customer_address") or "").strip(),
            "customer_phone": str(ctx.get("customer_phone") or "").strip(),
            "invoice_number": inv_no,
            "invoice_date": now.strftime("%b %d, %Y"),
            "product": "Custom Zebra Blinds",
            "description": "",
            "measurements": "",
            "installation_address": str(ctx.get("customer_address") or "").strip(),
            "total_project_price": f"{total:,.2f}",
            "deposit_paid": f"{down:,.2f}",
            "balance_due": f"{bal:,.2f}",
            "balance_paid": f"{paid_to_date:,.2f}",
            "extra_payments_total": f"{extra_total:,.2f}",
            "extra_payments_count": f"{extra_cnt} payment" + ("s" if extra_cnt != 1 else ""),
            "payments_received_total": f"{received_total:,.2f}",
            "payment_method": "",
            "payment_date": "",
            "status": "PAID" if paid else "DUE",
        },
    )

    ok = send_html_email(
        to_email=to_email,
        subject=subject,
        html="<p>Please see the attached final invoice.</p>",
        text="Please see the attached final invoice.",
        attachments=[(f"final-invoice-{oid}.pdf", pdf, "application/pdf")],
    )
    if not ok:
        raise HTTPException(status_code=500, detail="Email could not be sent (SMTP not configured or failed).")
    return None


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
    est_row = db.execute(
        text(
            """
            SELECT NULLIF(trim(estimate_id), '') AS estimate_id
            FROM orders
            WHERE company_id = CAST(:cid AS uuid) AND id = :oid AND active IS TRUE
            LIMIT 1
            """
        ),
        {"cid": str(cid), "oid": oid},
    ).mappings().first()
    est_id = (est_row.get("estimate_id") or "").strip() if est_row else ""
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
    if est_id:
        _sync_linked_estimate_to_cancelled(db, cid, est_id)
    db.execute(
        text(
            """
            UPDATE orders
            SET active = FALSE, updated_at = NOW()
            WHERE company_id = CAST(:cid AS uuid) AND parent_order_id = :oid AND active IS TRUE
            """
        ),
        {"cid": str(cid), "oid": oid},
    )
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
    est_row = db.execute(
        text(
            """
            SELECT NULLIF(trim(estimate_id), '') AS estimate_id
            FROM orders
            WHERE company_id = CAST(:cid AS uuid) AND id = :oid AND active IS FALSE
            LIMIT 1
            """
        ),
        {"cid": str(cid), "oid": oid},
    ).mappings().first()
    est_id = (est_row.get("estimate_id") or "").strip() if est_row else ""
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
    if est_id:
        _sync_linked_estimate_to_converted_after_order_uncancel(db, cid, est_id)
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
                      parent_order_id,
                      active, status_code,
                      created_at, updated_at
                    )
                    VALUES (
                      CAST(:cid AS uuid), :id, :customer_id,
                      :total_amount, :downpayment, NULL, :balance,
                      NULL, :agreement_date,
                      :estimate_id, :status_orde_id,
                      :parent_order_id,
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
                    "parent_order_id": None,
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
            _sync_order_done_status_with_balance(db, cid, new_id)
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=400, detail="Could not create order (invalid data).")
        return get_order(order_id=new_id, db=db, current_user=current_user)

    raise HTTPException(status_code=500, detail="Could not allocate order id, try again.")


@router.post("/{order_id}/line-item-additions", response_model=OrderDetailOut, status_code=status.HTTP_201_CREATED)
def create_line_item_addition(
    order_id: str,
    body: OrderLineItemAdditionCreateIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("orders.edit"))],
):
    """Append a child order linked to an anchor (`parent_order_id`). Tax uses the company's current rate."""
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    pid = order_id.strip()
    prow = db.execute(
        text(
            """
            SELECT
              o.customer_id::text AS customer_id,
              NULLIF(trim(o.parent_order_id::text), '') AS parent_order_id,
              COALESCE(o.active, FALSE) AS active
            FROM orders o
            WHERE o.company_id = CAST(:cid AS uuid) AND o.id = :oid
            LIMIT 1
            """
        ),
        {"cid": str(cid), "oid": pid},
    ).mappings().first()
    if not prow:
        raise HTTPException(status_code=404, detail="Order not found.")
    if not prow.get("active"):
        raise HTTPException(status_code=400, detail="Cannot add to a deleted order.")
    if prow.get("parent_order_id"):
        raise HTTPException(
            status_code=400,
            detail="Additions can only be created on an anchor order (open the main job, not an addition).",
        )

    cust_id = str(prow["customer_id"]).strip()
    lines = _normalize_blinds_lines(body.blinds_lines or [])
    if not lines:
        raise HTTPException(status_code=400, detail="Choose at least one blinds type.")
    validate_blinds_lines_categories(db, cid, lines)

    rate_pct = _company_tax_rate_percent(db, cid)
    tax_amt = _tax_amount_from_base(body.tax_uygulanacak_miktar, rate_pct)
    total_amount = _sum_blinds_line_amounts(lines)
    down = body.downpayment
    balance = _order_balance(total_amount, down, tax_amt, None)

    status_ord = _ensure_default_order_status_id(db, company_id=cid)

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
                      parent_order_id,
                      active, status_code,
                      created_at, updated_at
                    )
                    VALUES (
                      CAST(:cid AS uuid), :id, :customer_id,
                      :total_amount, :downpayment, NULL, :balance,
                      NULL, :agreement_date,
                      NULL, :status_orde_id,
                      :parent_order_id,
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
                    "status_orde_id": status_ord,
                    "parent_order_id": pid,
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
            _sync_order_done_status_with_balance(db, cid, new_id)
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=400, detail="Could not create line-item addition.")
        return get_order(order_id=pid, db=db, current_user=current_user)

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

    eff_bal = _order_balance(eff_total, eff_down, eff_tax, eff_fp)
    if eff_bal is not None:
        eff_bal = eff_bal.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    zb = eff_bal is not None and abs(eff_bal) <= _DONE_BALANCE_EPS
    done_now = bool(
        final_status_ord_id and _order_status_name_implies_done(db, cid, final_status_ord_id)
    )

    if zb and "status_orde_id" in patch_fields:
        if not final_status_ord_id or not done_now:
            raise HTTPException(
                status_code=400,
                detail="Order is fully paid; status must be Done.",
            )

    if "status_orde_id" in patch_fields and final_status_ord_id and done_now and not zb:
        raise HTTPException(
            status_code=400,
            detail="Order balance must be fully paid before status can be set to Done.",
        )

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
    _sync_order_done_status_with_balance(db, cid, oid)
    est_link = (cur.get("estimate_id") or "").strip()
    if est_link:
        old_sid = (cur.get("status_orde_id") or "").strip() or None
        old_cancel = _order_status_label_implies_cancelled(db, cid, old_sid)
        new_cancel = _order_status_label_implies_cancelled(db, cid, final_status_ord_id)
        if new_cancel and not old_cancel:
            _sync_linked_estimate_to_cancelled(db, cid, est_link)
        elif old_cancel and not new_cancel:
            _sync_linked_estimate_to_converted_after_order_uncancel(db, cid, est_link)
    db.commit()
    try_push_order_installation_to_google_calendar(
        db,
        company_id=cid,
        order_id=oid,
        acting_user_id=current_user.id,
    )
    return get_order(order_id=oid, db=db, current_user=current_user)
