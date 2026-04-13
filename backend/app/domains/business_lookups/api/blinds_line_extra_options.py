from __future__ import annotations

import secrets
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.dependencies.auth import effective_company_id, require_permissions
from app.domains.business_lookups.lookup_route_permissions import (
    LOOKUPS_KIND_EXTRA_VIEW_KEYS,
    require_lookup_extra_options,
)
from app.domains.user.models.users import Users

router = APIRouter()


class ExtraKindOut(BaseModel):
    id: str
    name: str
    line_json_key: str
    sort_order: int


class ExtraOptionOut(BaseModel):
    id: str
    name: str
    sort_order: int
    active: bool


class ExtraOptionCreate(BaseModel):
    id: Optional[str] = Field(
        default=None,
        max_length=32,
        description="Optional stable code; random id if omitted.",
    )
    name: str = Field(..., min_length=1, max_length=200)
    sort_order: int = Field(default=0, ge=0, le=999999)


class ExtraOptionPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    sort_order: Optional[int] = Field(default=None, ge=0, le=999999)
    active: Optional[bool] = None


def _kind_or_404(db: Session, kind_id: str) -> str:
    row = db.execute(
        text("SELECT id FROM blinds_line_extra_kind WHERE id = :kid AND active IS TRUE"),
        {"kid": kind_id.strip()},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Unknown line attribute kind.")
    return str(row["id"])


def _insert_option(db: Session, *, kind_id: str, code: str, name: str, sort_order: int) -> Any:
    return db.execute(
        text(
            """
            INSERT INTO blinds_line_extra_option (kind_id, code, name, sort_order, active, created_at, updated_at)
            VALUES (:kid, :code, :name, :ord, TRUE, NOW(), NOW())
            ON CONFLICT (kind_id, code) DO NOTHING
            RETURNING code AS id, name, sort_order, active
            """
        ),
        {"kid": kind_id, "code": code, "name": name, "ord": sort_order},
    ).mappings().first()


@router.get("/blinds-extra-option-kinds", response_model=list[ExtraKindOut])
def list_blinds_extra_option_kinds(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions(*LOOKUPS_KIND_EXTRA_VIEW_KEYS))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
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
    return [ExtraKindOut(**dict(r)) for r in rows]


@router.get("/blinds-extra-options/{kind_id}", response_model=list[ExtraOptionOut])
def list_blinds_extra_options(
    kind_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_lookup_extra_options("view"))],
    include_inactive: bool = Query(False),
    search: str | None = Query(None, max_length=200),
    limit: int = Query(300, ge=1, le=500),
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    kid = _kind_or_404(db, kind_id)
    term = (search or "").strip()
    where = ["kind_id = :kid"]
    params: dict[str, Any] = {"kid": kid, "limit": limit}
    if not include_inactive:
        where.append("active IS TRUE")
    if term:
        params["term"] = f"%{term}%"
        where.append("(name ILIKE :term OR code ILIKE :term)")
    wh = " AND ".join(where)
    rows = db.execute(
        text(
            f"""
            SELECT code AS id, name, sort_order, active
            FROM blinds_line_extra_option
            WHERE {wh}
            ORDER BY active DESC, sort_order ASC, name ASC
            LIMIT :limit
            """
        ),
        params,
    ).mappings().all()
    return [ExtraOptionOut(**dict(r)) for r in rows]


@router.post("/blinds-extra-options/{kind_id}", response_model=ExtraOptionOut)
def create_blinds_extra_option(
    kind_id: str,
    body: ExtraOptionCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_lookup_extra_options("edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    kid = _kind_or_404(db, kind_id)
    name = body.name.strip()
    explicit = (body.id or "").strip()
    if explicit:
        cid_key = explicit.lower()
        if len(cid_key) > 32 or len(cid_key) < 1:
            raise HTTPException(status_code=400, detail="id must be between 1 and 32 characters.")
        row = _insert_option(db, kind_id=kid, code=cid_key, name=name, sort_order=body.sort_order)
        if not row:
            raise HTTPException(status_code=409, detail="An option with this id already exists.")
    else:
        row = None
        for _ in range(12):
            cid_key = secrets.token_hex(8)
            row = _insert_option(db, kind_id=kid, code=cid_key, name=name, sort_order=body.sort_order)
            if row:
                break
        if not row:
            raise HTTPException(status_code=500, detail="Could not allocate a unique option id.")
    db.commit()
    return ExtraOptionOut(**dict(row))


@router.patch("/blinds-extra-options/{kind_id}/{option_id}", response_model=ExtraOptionOut)
def patch_blinds_extra_option(
    kind_id: str,
    option_id: str,
    body: ExtraOptionPatch,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_lookup_extra_options("edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    kid = _kind_or_404(db, kind_id)
    code = option_id.strip().lower()
    row = db.execute(
        text(
            """
            SELECT code AS id, name, sort_order, active
            FROM blinds_line_extra_option
            WHERE kind_id = :kid AND code = :code
            """
        ),
        {"kid": kid, "code": code},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Option not found.")

    name = body.name.strip() if body.name is not None else row["name"]
    sort_order = body.sort_order if body.sort_order is not None else row["sort_order"]
    active = row["active"] if body.active is None else body.active

    if body.active is False:
        db.execute(
            text(
                """
                DELETE FROM blinds_type_extra_allowed
                WHERE kind_id = :kid AND option_code = :code
                """
            ),
            {"kid": kid, "code": code},
        )

    db.execute(
        text(
            """
            UPDATE blinds_line_extra_option
            SET name = :name, sort_order = :ord, active = :active, updated_at = NOW()
            WHERE kind_id = :kid AND code = :code
            """
        ),
        {"name": name, "ord": sort_order, "active": active, "kid": kid, "code": code},
    )
    db.commit()

    row2 = db.execute(
        text(
            """
            SELECT code AS id, name, sort_order, active
            FROM blinds_line_extra_option
            WHERE kind_id = :kid AND code = :code
            """
        ),
        {"kid": kid, "code": code},
    ).mappings().one()
    return ExtraOptionOut(**dict(row2))
