"""Global estimate/order status catalogs and per-company matrix rows.

Ids match **DB/27_global_status_tables_and_matrix.sql** (md5 prefixes).
"""

from __future__ import annotations

import hashlib
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

ESTIMATE_BUILTIN_IDS: dict[str, str] = {
    "new": "86de9fe2784b1d0e",
    "pending": "c9dacb6c04910d38",
    "converted": "d75df7e9d38dce9a",
    "cancelled": "c840548f67545846",
}

DEFAULT_ORDER_STATUS_ID = "88efe5e3d3512afe"

# md5('global:ord:builtin:ready_for_install')[:16] — matches DB/28_*.sql
READY_FOR_INSTALL_ORDER_STATUS_ID = hashlib.md5(
    b"global:ord:builtin:ready_for_install"
).hexdigest()[:16]


def custom_estimate_status_id(normalized_name_lower: str) -> str:
    return hashlib.md5(f"global:est:custom:{normalized_name_lower}".encode("utf-8")).hexdigest()[:16]


def custom_order_status_id(normalized_name_lower: str) -> str:
    return hashlib.md5(f"global:ord:custom:{normalized_name_lower}".encode("utf-8")).hexdigest()[:16]


def ensure_global_estimate_catalog_seeded(db: Session) -> None:
    """Idempotent: built-in global estimate rows."""
    rows = [
        (ESTIMATE_BUILTIN_IDS["new"], "New Estimate", -1, "new"),
        (ESTIMATE_BUILTIN_IDS["pending"], "Pending", 0, "pending"),
        (ESTIMATE_BUILTIN_IDS["converted"], "Converted to order", 1, "converted"),
        (ESTIMATE_BUILTIN_IDS["cancelled"], "Cancelled", 2, "cancelled"),
    ]
    for sid, name, so, bk in rows:
        # Match on id OR builtin_kind: migrated DBs may use different ids but uq_status_estimate_global_builtin_nn
        # still blocks a second row with the same builtin_kind.
        db.execute(
            text(
                """
                INSERT INTO status_estimate (id, name, active, sort_order, builtin_kind)
                SELECT :id, :name, TRUE, :so, :bk
                WHERE NOT EXISTS (
                  SELECT 1 FROM status_estimate se
                  WHERE se.id = :id OR se.builtin_kind = :bk
                )
                """
            ),
            {"id": sid, "name": name, "so": so, "bk": bk},
        )


def ensure_global_order_catalog_seeded(db: Session) -> None:
    db.execute(
        text(
            """
            INSERT INTO status_order (id, name, active, sort_order)
            SELECT :id, 'New order', TRUE, 0
            WHERE NOT EXISTS (SELECT 1 FROM status_order WHERE id = :id)
            """
        ),
        {"id": DEFAULT_ORDER_STATUS_ID},
    )
    db.execute(
        text(
            """
            INSERT INTO status_order (id, name, active, sort_order)
            SELECT :id, 'Ready for installation', TRUE, 10
            WHERE NOT EXISTS (SELECT 1 FROM status_order WHERE id = :id)
            """
        ),
        {"id": READY_FOR_INSTALL_ORDER_STATUS_ID},
    )


def ensure_global_catalog_seeded(db: Session) -> None:
    ensure_global_estimate_catalog_seeded(db)
    ensure_global_order_catalog_seeded(db)


def ensure_company_estimate_matrix_defaults(db: Session, company_id: UUID) -> None:
    """Enable every active global estimate status for the company (matrix opt-out in UI)."""
    ensure_global_catalog_seeded(db)
    cid = str(company_id)
    db.execute(
        text(
            """
            INSERT INTO company_status_estimate_matrix (company_id, status_estimate_id)
            SELECT CAST(:cid AS uuid), se.id
            FROM status_estimate se
            WHERE se.active IS TRUE
            ON CONFLICT (company_id, status_estimate_id) DO NOTHING
            """
        ),
        {"cid": cid},
    )


def ensure_company_order_matrix_defaults(db: Session, company_id: UUID) -> None:
    ensure_global_catalog_seeded(db)
    cid = str(company_id)
    db.execute(
        text(
            """
            INSERT INTO company_status_order_matrix (company_id, status_order_id)
            SELECT CAST(:cid AS uuid), so.id
            FROM status_order so
            WHERE so.active IS TRUE
            ON CONFLICT (company_id, status_order_id) DO NOTHING
            """
        ),
        {"cid": cid},
    )


def ensure_default_estimate_statuses_for_company(db: Session, company_id: UUID) -> None:
    """Backward-compatible name: seed globals + matrix rows for a new or existing company."""
    ensure_global_catalog_seeded(db)
    ensure_company_estimate_matrix_defaults(db, company_id)
    ensure_company_order_matrix_defaults(db, company_id)
