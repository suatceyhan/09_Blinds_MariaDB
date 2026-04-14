"""Global order/estimate statuses and company×status matrix (Permissions hub)."""

from __future__ import annotations

import secrets
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from app.core.authorization import is_effective_superadmin
from app.core.database import get_db
from app.dependencies.auth import effective_company_id, require_permissions, require_superadmin
from app.domains.business_lookups.services.global_status_seed import (
    custom_estimate_status_id,
    custom_order_status_id,
    ensure_global_catalog_seeded,
)
from app.domains.user.models.users import Users

router = APIRouter(prefix="/permissions", tags=["Permissions — status matrices"])


def _new_row_id() -> str:
    return secrets.token_hex(8)


class CompanyBriefOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str


class GlobalEstimateStatusOut(BaseModel):
    id: str
    name: str
    active: bool
    sort_order: int = 0
    code: str | None = Field(None, description="builtin_kind when set")


class GlobalOrderStatusOut(BaseModel):
    id: str
    name: str
    active: bool
    sort_order: int = 0


class MatrixCellOut(BaseModel):
    company_id: UUID
    status_id: str
    enabled: bool


class EstimateStatusMatrixOut(BaseModel):
    companies: list[CompanyBriefOut]
    statuses: list[GlobalEstimateStatusOut]
    cells: list[MatrixCellOut]


class OrderStatusMatrixOut(BaseModel):
    companies: list[CompanyBriefOut]
    statuses: list[GlobalOrderStatusOut]
    cells: list[MatrixCellOut]


class MatrixPutIn(BaseModel):
    cells: list[MatrixCellOut]


class GlobalEstimateStatusCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=500)


class GlobalEstimateStatusPatchIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str | None = Field(None, min_length=1, max_length=500)
    active: bool | None = None
    sort_order: int | None = Field(None, ge=-999, le=9_999_999)


class GlobalOrderStatusCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=500)


class GlobalOrderStatusPatchIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str | None = Field(None, min_length=1, max_length=500)
    active: bool | None = None
    sort_order: int | None = Field(None, ge=0, le=9_999_999)


def _estimate_row_out(row: dict[str, Any]) -> GlobalEstimateStatusOut:
    bk = row.get("builtin_kind")
    code = str(bk).strip().lower() if bk else None
    return GlobalEstimateStatusOut(
        id=str(row["id"]),
        name=str(row["name"]),
        active=bool(row["active"]),
        sort_order=int(row.get("sort_order") or 0),
        code=code,
    )


def _assert_matrix_write(
    db: Session,
    current_user: Users,
    company_ids: set[UUID],
) -> None:
    if is_effective_superadmin(db, current_user.id, getattr(current_user, "active_role", None)):
        return
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    if company_ids != {cid}:
        raise HTTPException(status_code=403, detail="You can only edit the matrix for your active company.")


def _load_companies_scope(
    db: Session,
    current_user: Users,
) -> list[dict[str, Any]]:
    if is_effective_superadmin(db, current_user.id, getattr(current_user, "active_role", None)):
        rows = db.execute(
            text(
                """
                SELECT id, name
                FROM companies
                WHERE is_deleted IS NOT TRUE
                ORDER BY name ASC
                """
            )
        ).mappings().all()
        return [dict(r) for r in rows]
    cid = effective_company_id(current_user)
    if not cid:
        return []
    row = db.execute(
        text(
            """
            SELECT id, name FROM companies
            WHERE id = CAST(:cid AS uuid) AND is_deleted IS NOT TRUE
            LIMIT 1
            """
        ),
        {"cid": str(cid)},
    ).mappings().first()
    return [dict(row)] if row else []


@router.get("/estimate-status-matrix", response_model=EstimateStatusMatrixOut)
def get_estimate_status_matrix(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("settings.estimate_status_matrix.view"))],
):
    ensure_global_catalog_seeded(db)
    companies = _load_companies_scope(db, current_user)
    if not companies and not is_effective_superadmin(
        db, current_user.id, getattr(current_user, "active_role", None)
    ):
        raise HTTPException(status_code=403, detail="No active company.")
    st_rows = db.execute(
        text(
            """
            SELECT id, name, active, sort_order, builtin_kind
            FROM status_estimate
            ORDER BY sort_order ASC, name ASC
            """
        )
    ).mappings().all()
    statuses = [_estimate_row_out(dict(r)) for r in st_rows]
    cells: list[MatrixCellOut] = []
    if companies:
        if is_effective_superadmin(db, current_user.id, getattr(current_user, "active_role", None)):
            matrix_rows = db.execute(
                text(
                    """
                    SELECT company_id::text AS company_id, status_estimate_id AS status_id
                    FROM company_status_estimate_matrix
                    """
                )
            ).mappings().all()
        else:
            ec = effective_company_id(current_user)
            matrix_rows = (
                db.execute(
                    text(
                        """
                        SELECT company_id::text AS company_id, status_estimate_id AS status_id
                        FROM company_status_estimate_matrix
                        WHERE company_id = CAST(:cid AS uuid)
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
            for s in statuses:
                cells.append(
                    MatrixCellOut(
                        company_id=co["id"],
                        status_id=s.id,
                        enabled=(cid, s.id) in enabled_pairs,
                    )
                )
    return EstimateStatusMatrixOut(
        companies=[CompanyBriefOut(id=r["id"], name=str(r["name"] or "")) for r in companies],
        statuses=statuses,
        cells=cells,
    )


@router.put("/estimate-status-matrix", response_model=EstimateStatusMatrixOut)
def put_estimate_status_matrix(
    body: MatrixPutIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("settings.estimate_status_matrix.edit"))],
):
    ensure_global_catalog_seeded(db)
    company_ids = {c.company_id for c in body.cells}
    _assert_matrix_write(db, current_user, company_ids)
    for cell in body.cells:
        if cell.enabled:
            db.execute(
                text(
                    """
                    INSERT INTO company_status_estimate_matrix (company_id, status_estimate_id)
                    VALUES (CAST(:cid AS uuid), :sid)
                    ON CONFLICT (company_id, status_estimate_id) DO NOTHING
                    """
                ),
                {"cid": str(cell.company_id), "sid": cell.status_id.strip()},
            )
        else:
            db.execute(
                text(
                    """
                    DELETE FROM company_status_estimate_matrix
                    WHERE company_id = CAST(:cid AS uuid) AND status_estimate_id = :sid
                    """
                ),
                {"cid": str(cell.company_id), "sid": cell.status_id.strip()},
            )
    db.commit()
    return get_estimate_status_matrix(db, current_user)


@router.get("/order-status-matrix", response_model=OrderStatusMatrixOut)
def get_order_status_matrix(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("settings.order_status_matrix.view"))],
):
    ensure_global_catalog_seeded(db)
    companies = _load_companies_scope(db, current_user)
    if not companies and not is_effective_superadmin(
        db, current_user.id, getattr(current_user, "active_role", None)
    ):
        raise HTTPException(status_code=403, detail="No active company.")
    st_rows = db.execute(
        text(
            """
            SELECT id, name, active, sort_order
            FROM status_order
            ORDER BY sort_order ASC, name ASC
            """
        )
    ).mappings().all()
    statuses = [
        GlobalOrderStatusOut(
            id=str(r["id"]),
            name=str(r["name"]),
            active=bool(r["active"]),
            sort_order=int(r.get("sort_order") or 0),
        )
        for r in st_rows
    ]
    cells: list[MatrixCellOut] = []
    if companies:
        if is_effective_superadmin(db, current_user.id, getattr(current_user, "active_role", None)):
            matrix_rows = db.execute(
                text(
                    """
                    SELECT company_id::text AS company_id, status_order_id AS status_id
                    FROM company_status_order_matrix
                    """
                )
            ).mappings().all()
        else:
            ec = effective_company_id(current_user)
            matrix_rows = (
                db.execute(
                    text(
                        """
                        SELECT company_id::text AS company_id, status_order_id AS status_id
                        FROM company_status_order_matrix
                        WHERE company_id = CAST(:cid AS uuid)
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
            for s in statuses:
                cells.append(
                    MatrixCellOut(
                        company_id=co["id"],
                        status_id=s.id,
                        enabled=(cid, s.id) in enabled_pairs,
                    )
                )
    return OrderStatusMatrixOut(
        companies=[CompanyBriefOut(id=r["id"], name=str(r["name"] or "")) for r in companies],
        statuses=statuses,
        cells=cells,
    )


@router.put("/order-status-matrix", response_model=OrderStatusMatrixOut)
def put_order_status_matrix(
    body: MatrixPutIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("settings.order_status_matrix.edit"))],
):
    ensure_global_catalog_seeded(db)
    company_ids = {c.company_id for c in body.cells}
    _assert_matrix_write(db, current_user, company_ids)
    for cell in body.cells:
        if cell.enabled:
            db.execute(
                text(
                    """
                    INSERT INTO company_status_order_matrix (company_id, status_order_id)
                    VALUES (CAST(:cid AS uuid), :sid)
                    ON CONFLICT (company_id, status_order_id) DO NOTHING
                    """
                ),
                {"cid": str(cell.company_id), "sid": cell.status_id.strip()},
            )
        else:
            db.execute(
                text(
                    """
                    DELETE FROM company_status_order_matrix
                    WHERE company_id = CAST(:cid AS uuid) AND status_order_id = :sid
                    """
                ),
                {"cid": str(cell.company_id), "sid": cell.status_id.strip()},
            )
    db.commit()
    return get_order_status_matrix(db, current_user)


@router.post("/global-estimate-statuses", response_model=GlobalEstimateStatusOut, status_code=status.HTTP_201_CREATED)
def create_global_estimate_status(
    body: GlobalEstimateStatusCreateIn,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Users, Depends(require_superadmin)],
):
    ensure_global_catalog_seeded(db)
    nm = body.name.strip()
    exists_name = db.execute(
        text(
            """
            SELECT 1
            FROM status_estimate
            WHERE lower(btrim(name)) = lower(btrim(:name))
            LIMIT 1
            """
        ),
        {"name": nm},
    ).first()
    if exists_name:
        raise HTTPException(status_code=409, detail="An estimate status with this name already exists.")
    new_id = custom_estimate_status_id(nm)
    exists = db.execute(
        text("SELECT 1 FROM status_estimate WHERE id = :id LIMIT 1"),
        {"id": new_id},
    ).first()
    if exists:
        for _ in range(5):
            alt = _new_row_id()
            if not db.execute(text("SELECT 1 FROM status_estimate WHERE id = :id LIMIT 1"), {"id": alt}).first():
                new_id = alt
                break
        else:
            raise HTTPException(status_code=500, detail="Could not allocate status id.")
    next_so = db.execute(text("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM status_estimate")).scalar()
    try:
        db.execute(
            text(
                """
                INSERT INTO status_estimate (id, name, active, sort_order, builtin_kind)
                VALUES (:id, :name, TRUE, :so, NULL)
                """
            ),
            {"id": new_id, "name": nm, "so": int(next_so or 0)},
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Could not create estimate status.") from None
    row = db.execute(
        text(
            "SELECT id, name, active, sort_order, builtin_kind FROM status_estimate WHERE id = :id"
        ),
        {"id": new_id},
    ).mappings().one()
    return _estimate_row_out(dict(row))


@router.patch("/global-estimate-statuses/{status_id}", response_model=GlobalEstimateStatusOut)
def patch_global_estimate_status(
    status_id: str,
    body: GlobalEstimateStatusPatchIn,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Users, Depends(require_superadmin)],
):
    cur = db.execute(
        text(
            "SELECT id, name, active, sort_order, builtin_kind FROM status_estimate WHERE id = :id LIMIT 1"
        ),
        {"id": status_id.strip()},
    ).mappings().first()
    if not cur:
        raise HTTPException(status_code=404, detail="Estimate status not found.")
    if cur.get("builtin_kind"):
        raise HTTPException(status_code=400, detail="Built-in workflow statuses cannot be edited here.")
    name = cur["name"] if body.name is None else body.name.strip()
    if body.name is not None:
        exists_name = db.execute(
            text(
                """
                SELECT 1
                FROM status_estimate
                WHERE lower(btrim(name)) = lower(btrim(:name))
                  AND id <> :id
                LIMIT 1
                """
            ),
            {"name": name, "id": status_id.strip()},
        ).first()
        if exists_name:
            raise HTTPException(status_code=409, detail="An estimate status with this name already exists.")
    active = cur["active"] if body.active is None else body.active
    sort_order = cur["sort_order"] if body.sort_order is None else body.sort_order
    if body.active is False:
        used = db.execute(
            text(
                """
                SELECT 1
                FROM company_status_estimate_matrix
                WHERE status_estimate_id = :sid
                LIMIT 1
                """
            ),
            {"sid": status_id.strip()},
        ).first()
        if used:
            raise HTTPException(
                status_code=400,
                detail="This status is enabled for at least one company. Disable it in the matrix first.",
            )
    db.execute(
        text(
            """
            UPDATE status_estimate
            SET name = :name, active = :active, sort_order = :so
            WHERE id = :id
            """
        ),
        {"id": status_id.strip(), "name": name, "active": active, "so": int(sort_order or 0)},
    )
    db.commit()
    row = db.execute(
        text(
            "SELECT id, name, active, sort_order, builtin_kind FROM status_estimate WHERE id = :id"
        ),
        {"id": status_id.strip()},
    ).mappings().one()
    return _estimate_row_out(dict(row))


@router.post("/global-order-statuses", response_model=GlobalOrderStatusOut, status_code=status.HTTP_201_CREATED)
def create_global_order_status(
    body: GlobalOrderStatusCreateIn,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Users, Depends(require_superadmin)],
):
    ensure_global_catalog_seeded(db)
    nm = body.name.strip()
    exists_name = db.execute(
        text(
            """
            SELECT 1
            FROM status_order
            WHERE lower(btrim(name)) = lower(btrim(:name))
            LIMIT 1
            """
        ),
        {"name": nm},
    ).first()
    if exists_name:
        raise HTTPException(status_code=409, detail="An order status with this name already exists.")
    new_id = custom_order_status_id(nm)
    exists = db.execute(
        text("SELECT 1 FROM status_order WHERE id = :id LIMIT 1"),
        {"id": new_id},
    ).first()
    if exists:
        for _ in range(5):
            alt = _new_row_id()
            if not db.execute(text("SELECT 1 FROM status_order WHERE id = :id LIMIT 1"), {"id": alt}).first():
                new_id = alt
                break
        else:
            raise HTTPException(status_code=500, detail="Could not allocate status id.")
    next_so = db.execute(text("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM status_order")).scalar()
    try:
        db.execute(
            text(
                """
                INSERT INTO status_order (id, name, active, sort_order)
                VALUES (:id, :name, TRUE, :so)
                """
            ),
            {"id": new_id, "name": nm, "so": int(next_so or 0)},
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Could not create order status.") from None
    row = db.execute(
        text("SELECT id, name, active, sort_order FROM status_order WHERE id = :id"),
        {"id": new_id},
    ).mappings().one()
    return GlobalOrderStatusOut(
        id=str(row["id"]),
        name=str(row["name"]),
        active=bool(row["active"]),
        sort_order=int(row.get("sort_order") or 0),
    )


@router.patch("/global-order-statuses/{status_id}", response_model=GlobalOrderStatusOut)
def patch_global_order_status(
    status_id: str,
    body: GlobalOrderStatusPatchIn,
    db: Annotated[Session, Depends(get_db)],
    _: Annotated[Users, Depends(require_superadmin)],
):
    cur = db.execute(
        text("SELECT id, name, active, sort_order FROM status_order WHERE id = :id LIMIT 1"),
        {"id": status_id.strip()},
    ).mappings().first()
    if not cur:
        raise HTTPException(status_code=404, detail="Order status not found.")
    name = cur["name"] if body.name is None else body.name.strip()
    if body.name is not None:
        exists_name = db.execute(
            text(
                """
                SELECT 1
                FROM status_order
                WHERE lower(btrim(name)) = lower(btrim(:name))
                  AND id <> :id
                LIMIT 1
                """
            ),
            {"name": name, "id": status_id.strip()},
        ).first()
        if exists_name:
            raise HTTPException(status_code=409, detail="An order status with this name already exists.")
    active = cur["active"] if body.active is None else body.active
    sort_order = cur["sort_order"] if body.sort_order is None else body.sort_order
    if body.active is False:
        used = db.execute(
            text(
                """
                SELECT 1
                FROM company_status_order_matrix
                WHERE status_order_id = :sid
                LIMIT 1
                """
            ),
            {"sid": status_id.strip()},
        ).first()
        if used:
            raise HTTPException(
                status_code=400,
                detail="This status is enabled for at least one company. Disable it in the matrix first.",
            )
    db.execute(
        text(
            """
            UPDATE status_order
            SET name = :name, active = :active, sort_order = :so
            WHERE id = :id
            """
        ),
        {"id": status_id.strip(), "name": name, "active": active, "so": int(sort_order or 0)},
    )
    db.commit()
    row = db.execute(
        text("SELECT id, name, active, sort_order FROM status_order WHERE id = :id"),
        {"id": status_id.strip()},
    ).mappings().one()
    return GlobalOrderStatusOut(
        id=str(row["id"]),
        name=str(row["name"]),
        active=bool(row["active"]),
        sort_order=int(row.get("sort_order") or 0),
    )
