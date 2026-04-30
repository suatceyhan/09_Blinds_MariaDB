"""Per-company matrix for which global blinds types are enabled (Lookups)."""

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

router = APIRouter(prefix="/permissions", tags=["Permissions — blinds type matrix"])


class GlobalBlindsTypeBriefOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    active: bool
    sort_order: int = 0


class BlindsTypeMatrixOut(BaseModel):
    companies: list[CompanyBriefOut]
    types: list[GlobalBlindsTypeBriefOut]
    cells: list[MatrixCellOut]


@router.get("/blinds-type-matrix", response_model=BlindsTypeMatrixOut)
def get_blinds_type_matrix(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("lookups.blinds_types.view", "lookups.view"))],
):
    companies = _load_companies_scope(db, current_user)
    if not companies and not is_effective_superadmin(
        db, current_user.id, getattr(current_user, "active_role", None)
    ):
        raise HTTPException(status_code=403, detail="No active company.")
    type_rows = db.execute(
        text(
            """
            SELECT id, name, active, sort_order
            FROM blinds_type
            WHERE active IS TRUE
            ORDER BY sort_order ASC, name ASC
            """
        )
    ).mappings().all()
    types = [
        GlobalBlindsTypeBriefOut(
            id=str(r["id"]),
            name=str(r["name"]),
            active=bool(r["active"]),
            sort_order=int(r.get("sort_order") or 0),
        )
        for r in type_rows
    ]
    cells: list[MatrixCellOut] = []
    if companies:
        if is_effective_superadmin(db, current_user.id, getattr(current_user, "active_role", None)):
            matrix_rows = db.execute(
                text(
                    """
                    SELECT company_id AS company_id, blinds_type_id AS status_id
                    FROM company_blinds_type_matrix
                    """
                )
            ).mappings().all()
        else:
            ec = effective_company_id(current_user)
            matrix_rows = (
                db.execute(
                    text(
                        """
                        SELECT company_id AS company_id, blinds_type_id AS status_id
                        FROM company_blinds_type_matrix
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
            for t in types:
                cells.append(
                    MatrixCellOut(
                        company_id=co["id"],
                        status_id=t.id,
                        enabled=(cid, t.id) in enabled_pairs,
                    )
                )
    return BlindsTypeMatrixOut(
        companies=[CompanyBriefOut(id=r["id"], name=str(r["name"] or "")) for r in companies],
        types=types,
        cells=cells,
    )


@router.put("/blinds-type-matrix", response_model=BlindsTypeMatrixOut)
def put_blinds_type_matrix(
    body: MatrixPutIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("lookups.blinds_types.edit", "lookups.edit"))],
):
    company_ids = {c.company_id for c in body.cells}
    _assert_matrix_write(db, current_user, company_ids)
    for cell in body.cells:
        tid = cell.status_id.strip()
        if not tid:
            continue
        exists = db.execute(text("SELECT 1 FROM blinds_type WHERE id = :id LIMIT 1"), {"id": tid}).first()
        if not exists:
            continue
        if cell.enabled:
            db.execute(
                text(
                    """
                    INSERT INTO company_blinds_type_matrix (company_id, blinds_type_id)
                    VALUES (:cid, :tid)
                    ON CONFLICT (company_id, blinds_type_id) DO NOTHING
                    """
                ),
                {"cid": str(cell.company_id), "tid": tid},
            )
        else:
            db.execute(
                text(
                    """
                    DELETE FROM company_blinds_type_matrix
                    WHERE company_id = :cid AND blinds_type_id = :tid
                    """
                ),
                {"cid": str(cell.company_id), "tid": tid},
            )
    db.commit()
    return get_blinds_type_matrix(db, current_user)
