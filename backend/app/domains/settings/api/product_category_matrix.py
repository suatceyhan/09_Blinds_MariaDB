"""Per-company matrix for which global product categories are enabled (Lookups / Settings)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from app.core.authorization import is_effective_superadmin
from app.core.database import get_db
from app.dependencies.auth import effective_company_id, require_permissions
from app.domains.settings.api.status_matrices import (
    CompanyBriefOut,
    MatrixCellOut,
    MatrixPutIn,
    _assert_matrix_write,
    _load_companies_scope,
)
from app.domains.user.models.users import Users

router = APIRouter(prefix="/permissions", tags=["Permissions — product category matrix"])


class GlobalProductCategoryBriefOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    active: bool
    sort_order: int = 0


class ProductCategoryMatrixOut(BaseModel):
    companies: list[CompanyBriefOut]
    categories: list[GlobalProductCategoryBriefOut]
    cells: list[MatrixCellOut]


@router.get("/product-category-matrix", response_model=ProductCategoryMatrixOut)
def get_product_category_matrix(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("lookups.product_categories.view", "lookups.view"))],
):
    companies = _load_companies_scope(db, current_user)
    if not companies and not is_effective_superadmin(
        db, current_user.id, getattr(current_user, "active_role", None)
    ):
        raise HTTPException(status_code=403, detail="No active company.")
    cat_rows = db.execute(
        text(
            """
            SELECT code AS id, name, active, sort_order
            FROM blinds_product_category
            WHERE active IS TRUE
            ORDER BY sort_order ASC, name ASC
            """
        )
    ).mappings().all()
    categories = [
        GlobalProductCategoryBriefOut(
            id=str(r["id"]),
            name=str(r["name"]),
            active=bool(r["active"]),
            sort_order=int(r.get("sort_order") or 0),
        )
        for r in cat_rows
    ]
    cells: list[MatrixCellOut] = []
    if companies:
        if is_effective_superadmin(db, current_user.id, getattr(current_user, "active_role", None)):
            matrix_rows = db.execute(
                text(
                    """
                    SELECT company_id AS company_id, category_code AS status_id
                    FROM company_blinds_product_category_matrix
                    """
                )
            ).mappings().all()
        else:
            ec = effective_company_id(current_user)
            matrix_rows = (
                db.execute(
                    text(
                        """
                        SELECT company_id AS company_id, category_code AS status_id
                        FROM company_blinds_product_category_matrix
                        WHERE company_id = :cid
                        """
                    ),
                    {"cid": str(ec)},
                ).mappings().all()
                if ec
                else []
            )
        enabled_pairs = {(str(r["company_id"]), str(r["status_id"])) for r in matrix_rows}
        for co in companies:
            cid = str(co["id"])
            for c in categories:
                cells.append(
                    MatrixCellOut(
                        company_id=co["id"],
                        status_id=c.id,
                        enabled=(cid, c.id) in enabled_pairs,
                    )
                )
    return ProductCategoryMatrixOut(
        companies=[CompanyBriefOut(id=r["id"], name=str(r["name"] or "")) for r in companies],
        categories=categories,
        cells=cells,
    )


@router.put("/product-category-matrix", response_model=ProductCategoryMatrixOut)
def put_product_category_matrix(
    body: MatrixPutIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("lookups.product_categories.edit", "lookups.edit"))],
):
    company_ids = {c.company_id for c in body.cells}
    _assert_matrix_write(db, current_user, company_ids)
    for cell in body.cells:
        code = cell.status_id.strip()
        if not code:
            continue
        exists = db.execute(
            text("SELECT 1 FROM blinds_product_category WHERE code = :c LIMIT 1"),
            {"c": code},
        ).first()
        if not exists:
            continue
        if cell.enabled:
            db.execute(
                text(
                    """
                    INSERT IGNORE INTO company_blinds_product_category_matrix (company_id, category_code)
                    VALUES (:cid, :code)
                    """
                ),
                {"cid": str(cell.company_id), "code": code},
            )
        else:
            db.execute(
                text(
                    """
                    DELETE FROM company_blinds_product_category_matrix
                    WHERE company_id = :cid AND category_code = :code
                    """
                ),
                {"cid": str(cell.company_id), "code": code},
            )
    db.commit()
    return get_product_category_matrix(db, current_user)
