"""Default seeds + validation for global blinds product categories and type×category matrix."""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Iterable
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

def ensure_company_product_category_matrix_defaults(db: Session, company_id: UUID) -> None:
    """Enable every active global product category for the company (same idea as status matrices)."""
    cid = str(company_id)
    db.execute(
        text(
            """
            INSERT INTO company_blinds_product_category_matrix (company_id, category_code)
            SELECT CAST(:cid AS uuid), pc.code
            FROM blinds_product_category pc
            WHERE pc.active IS TRUE
            ON CONFLICT (company_id, category_code) DO NOTHING
            """
        ),
        {"cid": cid},
    )


def load_allowed_category_ids_by_type(db: Session, company_id: UUID) -> dict[str, list[str]]:
    rows = db.execute(
        text(
            """
            SELECT a.blinds_type_id, a.category_code
            FROM blinds_type_category_allowed a
            INNER JOIN company_blinds_product_category_matrix m
              ON m.company_id = a.company_id AND m.category_code = a.category_code
            INNER JOIN company_blinds_type_matrix tm
              ON tm.company_id = a.company_id AND tm.blinds_type_id = a.blinds_type_id
            WHERE a.company_id = CAST(:cid AS uuid)
            ORDER BY a.blinds_type_id, a.category_code
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


def assert_blinds_types_enabled_for_company(
    db: Session,
    company_id: UUID,
    blinds_type_ids: Iterable[str],
) -> None:
    """Each id must be an active global type enabled for the company matrix."""
    ids = {str(x).strip() for x in blinds_type_ids if str(x).strip()}
    if not ids:
        return
    id_list = list(ids)
    rows = db.execute(
        text(
            """
            SELECT bt.id::text
            FROM blinds_type bt
            INNER JOIN company_blinds_type_matrix m
              ON m.blinds_type_id = bt.id AND m.company_id = CAST(:cid AS uuid)
            WHERE bt.active IS TRUE AND bt.id IN :ids
            """
        ).bindparams(bindparam("ids", expanding=True)),
        {"cid": str(company_id), "ids": id_list},
    ).mappings().all()
    ok = {str(r["id"]) for r in rows}
    missing = ids - ok
    if missing:
        raise HTTPException(
            status_code=400,
            detail="One or more blinds types are not enabled for this company or are inactive.",
        )


def validate_blinds_lines_categories(
    db: Session,
    company_id: UUID,
    lines: list[dict[str, Any]],
) -> None:
    """Enforce matrix: no allowed categories => category must be empty; else category required and allowed."""
    if not lines:
        return
    assert_blinds_types_enabled_for_company(db, company_id, (ln.get("id") for ln in lines))
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
