from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.dependencies.auth import effective_company_id, require_permissions
from app.domains.user.models.users import Users

router = APIRouter()


class BlindsTypeOpt(BaseModel):
    id: str
    name: str


class ExtraOptionCol(BaseModel):
    id: str
    name: str
    sort_order: int


class BlindsTypeExtraPair(BaseModel):
    blinds_type_id: str = Field(..., min_length=1, max_length=64)
    option_code: str = Field(..., min_length=1, max_length=32)


class BlindsExtraMatrixPageOut(BaseModel):
    kind_id: str
    kind_name: str
    blinds_types: list[BlindsTypeOpt]
    options: list[ExtraOptionCol]
    allowed_pairs: list[BlindsTypeExtraPair]


class BlindsExtraMatrixUpdate(BaseModel):
    pairs: list[BlindsTypeExtraPair] = Field(default_factory=list)


class BlindsExtraMatrixKindBrief(BaseModel):
    id: str
    name: str
    sort_order: int


@router.get("/settings/blinds-extra-matrix-kinds", response_model=list[BlindsExtraMatrixKindBrief])
def list_blinds_extra_matrix_kinds(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("settings.access.view"))],
):
    """Active line-attribute kinds for matrix UIs (same rows as order form extras)."""
    rows = db.execute(
        text(
            """
            SELECT id, name, sort_order
            FROM blinds_line_extra_kind
            WHERE active IS TRUE
            ORDER BY sort_order ASC, name ASC
            """
        )
    ).mappings().all()
    return [
        BlindsExtraMatrixKindBrief(
            id=str(r["id"]),
            name=str(r["name"]),
            sort_order=int(r["sort_order"] or 0),
        )
        for r in rows
    ]


def _require_kind(db: Session, kind_id: str) -> dict:
    row = db.execute(
        text(
            """
            SELECT id, name, line_json_key
            FROM blinds_line_extra_kind
            WHERE id = :kid AND active IS TRUE
            """
        ),
        {"kid": kind_id.strip()},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Unknown line attribute kind.")
    return dict(row)


@router.get("/settings/blinds-extra-matrix/{kind_id}", response_model=BlindsExtraMatrixPageOut)
def get_blinds_extra_matrix(
    kind_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("settings.access.view"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    kind = _require_kind(db, kind_id)
    kid = str(kind["id"])

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

    options = db.execute(
        text(
            """
            SELECT code AS id, name, sort_order
            FROM blinds_line_extra_option
            WHERE kind_id = :kid AND active IS TRUE
            ORDER BY sort_order ASC, name ASC
            """
        ),
        {"kid": kid},
    ).mappings().all()

    pairs_raw = db.execute(
        text(
            """
            SELECT blinds_type_id, option_code
            FROM blinds_type_extra_allowed
            WHERE company_id = CAST(:cid AS uuid) AND kind_id = :kid
            ORDER BY blinds_type_id, option_code
            """
        ),
        {"cid": str(cid), "kid": kid},
    ).mappings().all()

    return BlindsExtraMatrixPageOut(
        kind_id=kid,
        kind_name=str(kind["name"]),
        blinds_types=[BlindsTypeOpt(id=str(r["id"]), name=str(r["name"])) for r in types_],
        options=[
            ExtraOptionCol(id=str(r["id"]), name=str(r["name"]), sort_order=int(r["sort_order"] or 0))
            for r in options
        ],
        allowed_pairs=[
            BlindsTypeExtraPair(blinds_type_id=str(r["blinds_type_id"]), option_code=str(r["option_code"]))
            for r in pairs_raw
        ],
    )


@router.put("/settings/blinds-extra-matrix/{kind_id}", response_model=BlindsExtraMatrixPageOut)
def put_blinds_extra_matrix(
    kind_id: str,
    body: BlindsExtraMatrixUpdate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("settings.access.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    kind = _require_kind(db, kind_id)
    kid = str(kind["id"])

    seen: set[tuple[str, str]] = set()
    cleaned: list[tuple[str, str]] = []
    for p in body.pairs:
        tid = p.blinds_type_id.strip()
        ocode = p.option_code.strip().lower()
        if not tid or not ocode:
            continue
        k = (tid, ocode)
        if k in seen:
            continue
        seen.add(k)
        cleaned.append((tid, ocode))

    for tid, ocode in cleaned:
        trow = db.execute(
            text(
                """
                SELECT id
                FROM blinds_type
                WHERE company_id = CAST(:cid AS uuid) AND id = :tid AND active IS TRUE
                """
            ),
            {"cid": str(cid), "tid": tid},
        ).mappings().first()
        if not trow:
            raise HTTPException(status_code=400, detail=f'Unknown blinds type id "{tid}".')

        orow = db.execute(
            text(
                """
                SELECT code
                FROM blinds_line_extra_option
                WHERE kind_id = :kid AND code = :ocode AND active IS TRUE
                """
            ),
            {"kid": kid, "ocode": ocode},
        ).mappings().first()
        if not orow:
            raise HTTPException(
                status_code=400,
                detail=f'Unknown or inactive option code "{ocode}" for this attribute.',
            )

    db.execute(
        text(
            """
            DELETE FROM blinds_type_extra_allowed
            WHERE company_id = CAST(:cid AS uuid) AND kind_id = :kid
            """
        ),
        {"cid": str(cid), "kid": kid},
    )
    for tid, ocode in cleaned:
        db.execute(
            text(
                """
                INSERT INTO blinds_type_extra_allowed (company_id, blinds_type_id, kind_id, option_code)
                VALUES (CAST(:cid AS uuid), :tid, :kid, :ocode)
                """
            ),
            {"cid": str(cid), "tid": tid, "kid": kid, "ocode": ocode},
        )
    db.commit()

    return get_blinds_extra_matrix(kind_id=kid, db=db, current_user=current_user)
