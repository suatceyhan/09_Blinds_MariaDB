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


class ProductCategoryCol(BaseModel):
    id: str
    name: str
    sort_order: int


class BlindsTypeCategoryPair(BaseModel):
    blinds_type_id: str = Field(..., min_length=1, max_length=64)
    category_code: str = Field(..., min_length=1, max_length=32)


class BlindsCategoryMatrixPageOut(BaseModel):
    blinds_types: list[BlindsTypeOpt]
    categories: list[ProductCategoryCol]
    allowed_pairs: list[BlindsTypeCategoryPair]


class BlindsCategoryMatrixUpdate(BaseModel):
    pairs: list[BlindsTypeCategoryPair] = Field(default_factory=list)


@router.get("/settings/blinds-category-matrix", response_model=BlindsCategoryMatrixPageOut)
def get_blinds_category_matrix(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("settings.access.view"))],
):
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

    categories = db.execute(
        text(
            """
            SELECT code AS id, name, sort_order
            FROM blinds_product_category
            WHERE active IS TRUE
            ORDER BY sort_order ASC, name ASC
            """
        ),
    ).mappings().all()

    pairs_raw = db.execute(
        text(
            """
            SELECT blinds_type_id, category_code
            FROM blinds_type_category_allowed
            WHERE company_id = CAST(:cid AS uuid)
            ORDER BY blinds_type_id, category_code
            """
        ),
        {"cid": str(cid)},
    ).mappings().all()

    return BlindsCategoryMatrixPageOut(
        blinds_types=[BlindsTypeOpt(id=str(r["id"]), name=str(r["name"])) for r in types_],
        categories=[
            ProductCategoryCol(id=str(r["id"]), name=str(r["name"]), sort_order=int(r["sort_order"] or 0))
            for r in categories
        ],
        allowed_pairs=[
            BlindsTypeCategoryPair(blinds_type_id=str(r["blinds_type_id"]), category_code=str(r["category_code"]))
            for r in pairs_raw
        ],
    )


@router.put("/settings/blinds-category-matrix", response_model=BlindsCategoryMatrixPageOut)
def put_blinds_category_matrix(
    body: BlindsCategoryMatrixUpdate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("settings.access.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    seen: set[tuple[str, str]] = set()
    cleaned: list[tuple[str, str]] = []
    for p in body.pairs:
        tid = p.blinds_type_id.strip()
        ccode = p.category_code.strip().lower()
        if not tid or not ccode:
            continue
        k = (tid, ccode)
        if k in seen:
            continue
        seen.add(k)
        cleaned.append((tid, ccode))

    for tid, ccode in cleaned:
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

        crow = db.execute(
            text(
                """
                SELECT code
                FROM blinds_product_category
                WHERE code = :ccode AND active IS TRUE
                """
            ),
            {"ccode": ccode},
        ).mappings().first()
        if not crow:
            raise HTTPException(
                status_code=400,
                detail=f'Unknown or inactive product category code "{ccode}".',
            )

    db.execute(
        text("DELETE FROM blinds_type_category_allowed WHERE company_id = CAST(:cid AS uuid)"),
        {"cid": str(cid)},
    )
    for tid, ccode in cleaned:
        db.execute(
            text(
                """
                INSERT INTO blinds_type_category_allowed (company_id, blinds_type_id, category_code)
                VALUES (CAST(:cid AS uuid), :tid, :ccode)
                """
            ),
            {"cid": str(cid), "tid": tid, "ccode": ccode},
        )
    db.commit()

    return get_blinds_category_matrix(db=db, current_user=current_user)
