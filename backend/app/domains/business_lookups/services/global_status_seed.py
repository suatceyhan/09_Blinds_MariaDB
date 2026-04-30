"""Global estimate/order status catalogs and per-company matrix rows.

This module must NOT rely on hardcoded status ids. All runtime logic should resolve
built-ins via `builtin_kind` and matrix enablement.
"""

from __future__ import annotations

import hashlib
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domains.business_lookups.services.blinds_catalog import ensure_company_product_category_matrix_defaults

def builtin_estimate_status_id(builtin_kind: str) -> str:
    """Deterministic id suggestion for new installs.

    Existing databases may already have different ids; we always de-dupe by builtin_kind.
    """
    return hashlib.md5(f"seed:status_estimate:builtin:{builtin_kind}".encode("utf-8")).hexdigest()[:16]


def builtin_order_status_id(builtin_kind: str) -> str:
    return hashlib.md5(f"seed:status_order:builtin:{builtin_kind}".encode("utf-8")).hexdigest()[:16]


def custom_estimate_status_id(normalized_name_lower: str) -> str:
    return hashlib.md5(f"global:est:custom:{normalized_name_lower}".encode("utf-8")).hexdigest()[:16]


def custom_order_status_id(normalized_name_lower: str) -> str:
    return hashlib.md5(f"global:ord:custom:{normalized_name_lower}".encode("utf-8")).hexdigest()[:16]


def ensure_global_estimate_catalog_seeded(db: Session) -> None:
    """Idempotent: built-in global estimate rows."""
    rows = [
        ("new", "New Estimate", -1),
        ("pending", "Pending", 0),
        ("converted", "Converted to order", 1),
        ("cancelled", "Cancelled", 2),
    ]
    for bk, name, so in rows:
        db.execute(
            text(
                """
                INSERT INTO status_estimate (id, name, active, sort_order, builtin_kind)
                SELECT :id, :name, TRUE, :so, :bk
                WHERE NOT EXISTS (
                  SELECT 1 FROM status_estimate se
                  WHERE se.builtin_kind = :bk
                )
                """
            ),
            {"id": builtin_estimate_status_id(bk), "name": name, "so": so, "bk": bk},
        )


def ensure_global_order_catalog_seeded(db: Session) -> None:
    rows = [
        ("new", "New order", 0),
        ("ready_for_install", "Ready for installation", 10),
        ("in_production", "In Production", 20),
        ("done", "Done", 30),
    ]
    for bk, name, so in rows:
        db.execute(
            text(
                """
                INSERT INTO status_order (id, name, active, sort_order, builtin_kind)
                SELECT :id, :name, TRUE, :so, :bk
                WHERE NOT EXISTS (
                  SELECT 1 FROM status_order so
                  WHERE so.builtin_kind = :bk
                )
                """
            ),
            {"id": builtin_order_status_id(bk), "name": name, "so": so, "bk": bk},
        )


def ensure_global_catalog_seeded(db: Session) -> None:
    ensure_global_estimate_catalog_seeded(db)
    ensure_global_order_catalog_seeded(db)


def ensure_company_estimate_matrix_defaults(db: Session, company_id: UUID) -> None:
    """Seed estimate status matrix when empty (built-ins only).

    Important: do NOT auto-enable newly created custom statuses for existing companies.
    """
    ensure_global_catalog_seeded(db)
    if not settings.bootstrap_prefill_company_lookup_matrices:
        return
    cid = str(company_id)
    any_row = db.execute(
        text(
            """
            SELECT 1
            FROM company_status_estimate_matrix
            WHERE company_id = CAST(:cid AS uuid)
            LIMIT 1
            """
        ),
        {"cid": cid},
    ).first()
    if any_row:
        return
    db.execute(
        text(
            """
            INSERT INTO company_status_estimate_matrix (company_id, status_estimate_id)
            SELECT CAST(:cid AS uuid), se.id
            FROM status_estimate se
            WHERE se.active IS TRUE AND se.builtin_kind IS NOT NULL
            ON CONFLICT (company_id, status_estimate_id) DO NOTHING
            """
        ),
        {"cid": cid},
    )


def ensure_company_order_matrix_defaults(db: Session, company_id: UUID) -> None:
    ensure_global_catalog_seeded(db)
    if not settings.bootstrap_prefill_company_lookup_matrices:
        return
    cid = str(company_id)
    any_row = db.execute(
        text(
            """
            SELECT 1
            FROM company_status_order_matrix
            WHERE company_id = CAST(:cid AS uuid)
            LIMIT 1
            """
        ),
        {"cid": cid},
    ).first()
    if any_row:
        return
    db.execute(
        text(
            """
            INSERT INTO company_status_order_matrix (company_id, status_order_id)
            SELECT CAST(:cid AS uuid), so.id
            FROM status_order so
            WHERE so.active IS TRUE AND so.builtin_kind IN ('new', 'ready_for_install', 'in_production', 'done')
            ON CONFLICT (company_id, status_order_id) DO NOTHING
            """
        ),
        {"cid": cid},
    )


def ensure_company_blinds_type_matrix_defaults(db: Session, company_id: UUID) -> None:
    """Seed blinds type matrix for a company when empty.

    Important: do NOT auto-enable newly created types for existing companies.
    """
    if not settings.bootstrap_prefill_company_lookup_matrices:
        return
    cid = str(company_id)
    any_row = db.execute(
        text(
            """
            SELECT 1
            FROM company_blinds_type_matrix
            WHERE company_id = CAST(:cid AS uuid)
            LIMIT 1
            """
        ),
        {"cid": cid},
    ).first()
    if any_row:
        return
    db.execute(
        text(
            """
            INSERT INTO company_blinds_type_matrix (company_id, blinds_type_id)
            SELECT CAST(:cid AS uuid), bt.id
            FROM blinds_type bt
            WHERE bt.active IS TRUE
            ON CONFLICT (company_id, blinds_type_id) DO NOTHING
            """
        ),
        {"cid": cid},
    )


def ensure_default_estimate_statuses_for_company(db: Session, company_id: UUID) -> None:
    """Ensure global status catalogs exist; optionally prefill tenant matrices (see bootstrap_prefill_company_lookup_matrices)."""
    ensure_global_catalog_seeded(db)
    ensure_company_estimate_matrix_defaults(db, company_id)
    ensure_company_order_matrix_defaults(db, company_id)
    ensure_company_product_category_matrix_defaults(db, company_id)
    ensure_company_blinds_type_matrix_defaults(db, company_id)
