"""Extra blinds line attributes (lifting system, cassette type, …) + per-type matrix validation."""

from __future__ import annotations

from collections import defaultdict
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.domains.business_lookups.services.blinds_catalog import (
    normalize_blinds_line_category_value,
    validate_blinds_lines_categories,
)


def get_active_extra_kinds(db: Session) -> list[dict[str, Any]]:
    rows = db.execute(
        text(
            """
            SELECT id, name, line_json_key, sort_order
            FROM blinds_line_extra_kind
            WHERE active IS TRUE
            ORDER BY sort_order ASC, name ASC
            """
        )
    ).mappings().all()
    return [dict(r) for r in rows]


def load_allowed_extra_options_by_type(db: Session, company_id: UUID, kind_id: str) -> dict[str, list[str]]:
    rows = db.execute(
        text(
            """
            SELECT blinds_type_id, option_code
            FROM blinds_type_extra_allowed
            WHERE company_id = CAST(:cid AS uuid) AND kind_id = :kid
            ORDER BY blinds_type_id, option_code
            """
        ),
        {"cid": str(company_id), "kid": kind_id},
    ).mappings().all()
    m: dict[str, list[str]] = defaultdict(list)
    for r in rows:
        m[str(r["blinds_type_id"])].append(str(r["option_code"]))
    return dict(m)


def validate_blinds_lines_all_attributes(
    db: Session,
    company_id: UUID,
    lines: list[dict[str, Any]],
) -> None:
    validate_blinds_lines_categories(db, company_id, lines)
    if not lines:
        return
    for kind in get_active_extra_kinds(db):
        kid = str(kind["id"])
        jkey = str(kind["line_json_key"])
        label = str(kind["name"])
        allowed_map = load_allowed_extra_options_by_type(db, company_id, kid)
        for ln in lines:
            tid = str(ln.get("id") or "").strip()
            name = str(ln.get("name") or tid or "line").strip()
            val = normalize_blinds_line_category_value(ln.get(jkey))
            allowed = allowed_map.get(tid, [])
            if not allowed:
                if val:
                    raise HTTPException(
                        status_code=400,
                        detail=(
                            f'"{label}" is not used for blinds type "{name}". '
                            "Clear the value or configure the matrix under Settings."
                        ),
                    )
                ln[jkey] = None
                continue
            if not val:
                raise HTTPException(
                    status_code=400,
                    detail=f'Choose {label} for blinds type "{name}".',
                )
            if val not in allowed:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f'The selected {label.lower()} is not allowed for blinds type "{name}". '
                        "Update the matrix under Settings."
                    ),
                )
            ln[jkey] = val
