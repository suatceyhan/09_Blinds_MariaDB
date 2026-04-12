"""Default seeds + validation for global blinds product categories and type×category matrix."""

from __future__ import annotations

from collections import defaultdict
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

def load_allowed_category_ids_by_type(db: Session, company_id: UUID) -> dict[str, list[str]]:
    rows = db.execute(
        text(
            """
            SELECT blinds_type_id, category_code
            FROM blinds_type_category_allowed
            WHERE company_id = CAST(:cid AS uuid)
            ORDER BY blinds_type_id, category_code
            """
        ),
        {"cid": str(company_id)},
    ).mappings().all()
    m: dict[str, list[str]] = defaultdict(list)
    for r in rows:
        m[str(r["blinds_type_id"])].append(str(r["category_code"]))
    return dict(m)


def normalize_blinds_line_category_value(raw: Any) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip().lower()
    if not s:
        return None
    if len(s) > 32:
        s = s[:32]
    return s


def validate_blinds_lines_categories(
    db: Session,
    company_id: UUID,
    lines: list[dict[str, Any]],
) -> None:
    """Enforce matrix: no allowed categories => category must be empty; else category required and allowed."""
    if not lines:
        return
    allowed_map = load_allowed_category_ids_by_type(db, company_id)
    for ln in lines:
        tid = str(ln.get("id") or "").strip()
        name = str(ln.get("name") or tid or "line").strip()
        cat = normalize_blinds_line_category_value(ln.get("category"))
        allowed = allowed_map.get(tid, [])
        if not allowed:
            if cat:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f'Product category is not used for blinds type "{name}". '
                        "Clear the category or configure the matrix under Settings."
                    ),
                )
            ln["category"] = None
            continue
        if not cat:
            raise HTTPException(
                status_code=400,
                detail=f'Choose a product category for blinds type "{name}".',
            )
        if cat not in allowed:
            raise HTTPException(
                status_code=400,
                detail=(
                    f'Product category "{cat}" is not allowed for blinds type "{name}". '
                    "Update Settings → Blinds type × category matrix."
                ),
            )
        ln["category"] = cat
