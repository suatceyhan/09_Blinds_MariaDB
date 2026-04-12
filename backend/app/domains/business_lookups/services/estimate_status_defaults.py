"""Built-in `status_estimate` rows per company (pending / converted / cancelled).

Migration **DB/19_status_estimate_lookup.sql** seeds existing companies only. New companies created
later need the same rows — this module inserts them idempotently (same id formula as the migration).
"""

from __future__ import annotations

import hashlib
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session


def _builtin_estimate_status_id(company_id: UUID, kind: str) -> str:
    """Matches PostgreSQL: substring(md5(company_id::text || ':est:' || slug), 1, 16)."""
    return hashlib.md5(f"{company_id}:est:{kind}".encode("utf-8")).hexdigest()[:16]


def ensure_default_estimate_statuses_for_company(db: Session, company_id: UUID) -> None:
    """Insert built-in estimate statuses when missing (safe to call multiple times)."""
    cid = str(company_id)
    for builtin_kind, name, sort_order in (
        ("pending", "Pending", 0),
        ("converted", "Converted to order", 1),
        ("cancelled", "Cancelled", 2),
    ):
        row_id = _builtin_estimate_status_id(company_id, builtin_kind)
        db.execute(
            text(
                """
                INSERT INTO status_estimate (company_id, id, builtin_kind, name, active, sort_order)
                SELECT CAST(:cid AS uuid), :row_id, :bk, :name, TRUE, :sort_order
                WHERE NOT EXISTS (
                  SELECT 1 FROM status_estimate
                  WHERE company_id = CAST(:cid AS uuid) AND builtin_kind = :bk
                )
                """
            ),
            {
                "cid": cid,
                "row_id": row_id,
                "bk": builtin_kind,
                "name": name,
                "sort_order": sort_order,
            },
        )
