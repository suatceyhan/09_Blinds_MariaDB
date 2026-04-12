import secrets
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from app.core.database import get_db
from app.dependencies.auth import effective_company_id, require_permissions
from app.domains.user.models.users import Users


router = APIRouter(prefix="/lookups", tags=["Lookups"])


def _new_row_id() -> str:
    return secrets.token_hex(8)


def _normalize_aciklama(val: str | None) -> str | None:
    """Strip outer whitespace; keep internal newlines; normalize CRLF to LF."""
    if val is None:
        return None
    s = val.replace("\r\n", "\n").replace("\r", "\n").strip()
    return s or None


# --- Blinds type ---


class BlindsTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: UUID
    name: str
    aciklama: str | None = None
    active: bool


class BlindsTypeCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=500)
    aciklama: str | None = Field(None, max_length=4000)


class BlindsTypePatchIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str | None = Field(None, min_length=1, max_length=500)
    aciklama: str | None = Field(None, max_length=4000)
    active: bool | None = None


@router.get("/blinds-types", response_model=list[BlindsTypeOut])
def list_blinds_types(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("lookups.view"))],
    search: str | None = Query(None, max_length=200),
    include_inactive: bool = Query(False),
    limit: int = Query(300, ge=1, le=500),
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    term = (search or "").strip()
    where = ["bt.company_id = :company_id"]
    params: dict[str, Any] = {"company_id": str(cid), "limit": limit}
    if not include_inactive:
        where.append("bt.active IS TRUE")
    if term:
        params["term"] = f"%{term}%"
        where.append("(bt.name ILIKE :term OR COALESCE(bt.aciklama,'') ILIKE :term)")
    w = " AND ".join(where)
    rows = db.execute(
        text(
            f"""
            SELECT bt.company_id, bt.id, bt.name, bt.aciklama, bt.active
            FROM blinds_type bt
            WHERE {w}
            ORDER BY bt.active DESC, bt.name ASC
            LIMIT :limit
            """
        ),
        params,
    ).mappings().all()
    return [BlindsTypeOut(**dict(r)) for r in rows]


@router.post("/blinds-types", response_model=BlindsTypeOut, status_code=status.HTTP_201_CREATED)
def create_blinds_type(
    body: BlindsTypeCreateIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("lookups.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    for _ in range(5):
        new_id = _new_row_id()
        exists = db.execute(
            text("SELECT 1 FROM blinds_type WHERE company_id = :c AND id = :id LIMIT 1"),
            {"c": str(cid), "id": new_id},
        ).first()
        if exists:
            continue
        try:
            db.execute(
                text(
                    """
                    INSERT INTO blinds_type (company_id, id, name, aciklama, active)
                    VALUES (:company_id, :id, :name, :aciklama, TRUE)
                    """
                ),
                {
                    "company_id": str(cid),
                    "id": new_id,
                    "name": body.name.strip(),
                    "aciklama": _normalize_aciklama(body.aciklama),
                },
            )
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=400, detail="Could not create blinds type.")
        row = db.execute(
            text(
                """
                SELECT company_id, id, name, aciklama, active
                FROM blinds_type
                WHERE company_id = :company_id AND id = :id
                """
            ),
            {"company_id": str(cid), "id": new_id},
        ).mappings().one()
        return BlindsTypeOut(**dict(row))
    raise HTTPException(status_code=500, detail="Could not allocate id, try again.")


@router.patch("/blinds-types/{blinds_type_id}", response_model=BlindsTypeOut)
def patch_blinds_type(
    blinds_type_id: str,
    body: BlindsTypePatchIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("lookups.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    current = db.execute(
        text(
            """
            SELECT company_id, id, name, aciklama, active
            FROM blinds_type
            WHERE company_id = :company_id AND id = :id
            """
        ),
        {"company_id": str(cid), "id": blinds_type_id},
    ).mappings().first()
    if not current:
        raise HTTPException(status_code=404, detail="Blinds type not found.")
    name = current["name"] if body.name is None else body.name.strip()
    aciklama = current["aciklama"] if body.aciklama is None else _normalize_aciklama(body.aciklama)
    active = current["active"] if body.active is None else body.active
    db.execute(
        text(
            """
            UPDATE blinds_type
            SET name = :name, aciklama = :aciklama, active = :active
            WHERE company_id = :company_id AND id = :id
            """
        ),
        {
            "company_id": str(cid),
            "id": blinds_type_id,
            "name": name,
            "aciklama": aciklama,
            "active": active,
        },
    )
    db.commit()
    row = db.execute(
        text(
            """
            SELECT company_id, id, name, aciklama, active
            FROM blinds_type
            WHERE company_id = :company_id AND id = :id
            """
        ),
        {"company_id": str(cid), "id": blinds_type_id},
    ).mappings().one()
    return BlindsTypeOut(**dict(row))


# --- Order status (status_order) ---


class OrderStatusOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: UUID
    name: str
    active: bool
    sort_order: int = 0


class OrderStatusCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=500)


class OrderStatusPatchIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str | None = Field(None, min_length=1, max_length=500)
    active: bool | None = None
    sort_order: int | None = Field(None, ge=0, le=9_999_999)


@router.get("/order-statuses", response_model=list[OrderStatusOut])
def list_order_statuses(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("lookups.view"))],
    search: str | None = Query(None, max_length=200),
    include_inactive: bool = Query(False),
    limit: int = Query(300, ge=1, le=500),
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    term = (search or "").strip()
    where = ["so.company_id = :company_id"]
    params: dict[str, Any] = {"company_id": str(cid), "limit": limit}
    if not include_inactive:
        where.append("so.active IS TRUE")
    if term:
        params["term"] = f"%{term}%"
        where.append("so.name ILIKE :term")
    w = " AND ".join(where)
    rows = db.execute(
        text(
            f"""
            SELECT so.company_id, so.id, so.name, so.active, so.sort_order
            FROM status_order so
            WHERE {w}
            ORDER BY so.sort_order ASC, so.active DESC, so.name ASC
            LIMIT :limit
            """
        ),
        params,
    ).mappings().all()
    return [OrderStatusOut(**dict(r)) for r in rows]


@router.post("/order-statuses", response_model=OrderStatusOut, status_code=status.HTTP_201_CREATED)
def create_order_status(
    body: OrderStatusCreateIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("lookups.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    for _ in range(5):
        new_id = _new_row_id()
        exists = db.execute(
            text("SELECT 1 FROM status_order WHERE company_id = :c AND id = :id LIMIT 1"),
            {"c": str(cid), "id": new_id},
        ).first()
        if exists:
            continue
        try:
            next_so = db.execute(
                text(
                    """
                    SELECT COALESCE(MAX(sort_order), -1) + 1 AS n
                    FROM status_order
                    WHERE company_id = CAST(:cid AS uuid)
                    """
                ),
                {"cid": str(cid)},
            ).scalar()
            db.execute(
                text(
                    """
                    INSERT INTO status_order (company_id, id, name, active, sort_order)
                    VALUES (:company_id, :id, :name, TRUE, :sort_order)
                    """
                ),
                {
                    "company_id": str(cid),
                    "id": new_id,
                    "name": body.name.strip(),
                    "sort_order": int(next_so or 0),
                },
            )
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=400, detail="Could not create order status.")
        row = db.execute(
            text(
                """
                SELECT company_id, id, name, active, sort_order
                FROM status_order
                WHERE company_id = :company_id AND id = :id
                """
            ),
            {"company_id": str(cid), "id": new_id},
        ).mappings().one()
        return OrderStatusOut(**dict(row))
    raise HTTPException(status_code=500, detail="Could not allocate id, try again.")


@router.patch("/order-statuses/{status_id}", response_model=OrderStatusOut)
def patch_order_status(
    status_id: str,
    body: OrderStatusPatchIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("lookups.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    current = db.execute(
        text(
            """
            SELECT company_id, id, name, active, sort_order
            FROM status_order
            WHERE company_id = :company_id AND id = :id
            """
        ),
        {"company_id": str(cid), "id": status_id},
    ).mappings().first()
    if not current:
        raise HTTPException(status_code=404, detail="Order status not found.")
    name = current["name"] if body.name is None else body.name.strip()
    active = current["active"] if body.active is None else body.active
    sort_order = current["sort_order"] if body.sort_order is None else body.sort_order
    db.execute(
        text(
            """
            UPDATE status_order
            SET name = :name, active = :active, sort_order = :sort_order
            WHERE company_id = :company_id AND id = :id
            """
        ),
        {
            "company_id": str(cid),
            "id": status_id,
            "name": name,
            "active": active,
            "sort_order": int(sort_order or 0),
        },
    )
    db.commit()
    row = db.execute(
        text(
            """
            SELECT company_id, id, name, active, sort_order
            FROM status_order
            WHERE company_id = :company_id AND id = :id
            """
        ),
        {"company_id": str(cid), "id": status_id},
    ).mappings().one()
    return OrderStatusOut(**dict(row))


# --- Estimate status (status_estimate): same UX as order statuses; optional internal slug for workflow rows ---


class EstimateStatusOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: UUID
    name: str
    active: bool
    sort_order: int = 0
    workflow: str | None = Field(
        default=None,
        description="pending | converted | cancelled for built-in rows; null for custom labels (no slug).",
    )


class EstimateStatusCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=500)


class EstimateStatusPatchIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str | None = Field(None, min_length=1, max_length=500)
    active: bool | None = None
    sort_order: int | None = Field(None, ge=0, le=9_999_999)


def _estimate_status_row_out(row: dict[str, Any]) -> EstimateStatusOut:
    d = dict(row)
    slug = d.pop("slug", None)
    d["workflow"] = str(slug).strip().lower() if slug else None
    return EstimateStatusOut(**d)


@router.get("/estimate-statuses", response_model=list[EstimateStatusOut])
def list_estimate_statuses(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("lookups.view"))],
    search: str | None = Query(None, max_length=200),
    include_inactive: bool = Query(False),
    limit: int = Query(300, ge=1, le=500),
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    term = (search or "").strip()
    where = ["se.company_id = :company_id"]
    params: dict[str, Any] = {"company_id": str(cid), "limit": limit}
    if not include_inactive:
        where.append("se.active IS TRUE")
    if term:
        params["term"] = f"%{term}%"
        where.append("se.name ILIKE :term")
    w = " AND ".join(where)
    rows = db.execute(
        text(
            f"""
            SELECT se.company_id, se.id, se.slug, se.name, se.active, se.sort_order
            FROM status_estimate se
            WHERE {w}
            ORDER BY se.sort_order ASC, se.active DESC, se.name ASC
            LIMIT :limit
            """
        ),
        params,
    ).mappings().all()
    return [_estimate_status_row_out(dict(r)) for r in rows]


@router.post("/estimate-statuses", response_model=EstimateStatusOut, status_code=status.HTTP_201_CREATED)
def create_estimate_status(
    body: EstimateStatusCreateIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("lookups.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    for _ in range(5):
        new_id = _new_row_id()
        exists = db.execute(
            text("SELECT 1 FROM status_estimate WHERE company_id = :c AND id = :id LIMIT 1"),
            {"c": str(cid), "id": new_id},
        ).first()
        if exists:
            continue
        try:
            next_so = db.execute(
                text(
                    """
                    SELECT COALESCE(MAX(sort_order), -1) + 1 AS n
                    FROM status_estimate
                    WHERE company_id = CAST(:cid AS uuid)
                    """
                ),
                {"cid": str(cid)},
            ).scalar()
            db.execute(
                text(
                    """
                    INSERT INTO status_estimate (company_id, id, slug, name, active, sort_order)
                    VALUES (:company_id, :id, NULL, :name, TRUE, :sort_order)
                    """
                ),
                {
                    "company_id": str(cid),
                    "id": new_id,
                    "name": body.name.strip(),
                    "sort_order": int(next_so or 0),
                },
            )
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=400, detail="Could not create estimate status.")
        row = db.execute(
            text(
                """
                SELECT company_id, id, slug, name, active, sort_order
                FROM status_estimate
                WHERE company_id = :company_id AND id = :id
                """
            ),
            {"company_id": str(cid), "id": new_id},
        ).mappings().one()
        return _estimate_status_row_out(dict(row))
    raise HTTPException(status_code=500, detail="Could not allocate id, try again.")


@router.patch("/estimate-statuses/{status_id}", response_model=EstimateStatusOut)
def patch_estimate_status(
    status_id: str,
    body: EstimateStatusPatchIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("lookups.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    current = db.execute(
        text(
            """
            SELECT company_id, id, slug, name, active, sort_order
            FROM status_estimate
            WHERE company_id = :company_id AND id = :id
            """
        ),
        {"company_id": str(cid), "id": status_id},
    ).mappings().first()
    if not current:
        raise HTTPException(status_code=404, detail="Estimate status not found.")
    name = current["name"] if body.name is None else body.name.strip()
    active = current["active"] if body.active is None else body.active
    sort_order = current["sort_order"] if body.sort_order is None else body.sort_order
    db.execute(
        text(
            """
            UPDATE status_estimate
            SET name = :name, active = :active, sort_order = :sort_order
            WHERE company_id = :company_id AND id = :id
            """
        ),
        {
            "company_id": str(cid),
            "id": status_id,
            "name": name,
            "active": active,
            "sort_order": int(sort_order or 0),
        },
    )
    db.commit()
    row = db.execute(
        text(
            """
            SELECT company_id, id, slug, name, active, sort_order
            FROM status_estimate
            WHERE company_id = :company_id AND id = :id
            """
        ),
        {"company_id": str(cid), "id": status_id},
    ).mappings().one()
    return _estimate_status_row_out(dict(row))


from app.domains.business_lookups.api.blinds_product_categories import (  # noqa: E402
    router as _blinds_product_categories_router,
)
from app.domains.business_lookups.api.blinds_line_extra_options import (  # noqa: E402
    router as _blinds_line_extra_options_router,
)

router.include_router(_blinds_product_categories_router)
router.include_router(_blinds_line_extra_options_router)
