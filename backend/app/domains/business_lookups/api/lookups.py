import secrets
from typing import Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from app.core.authorization import has_permission
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


# --- Blinds type (global catalog + per-company matrix) ---


class BlindsTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    aciklama: str | None = None
    active: bool
    sort_order: int = 0


class BlindsTypeCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=500)
    aciklama: str | None = Field(None, max_length=4000)
    sort_order: int | None = Field(None, ge=0, le=9_999_999)


class BlindsTypePatchIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str | None = Field(None, min_length=1, max_length=500)
    aciklama: str | None = Field(None, max_length=4000)
    active: bool | None = None
    sort_order: int | None = Field(None, ge=0, le=9_999_999)


@router.get("/blinds-types", response_model=list[BlindsTypeOut])
def list_blinds_types(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("lookups.blinds_types.view", "lookups.view"))],
    search: str | None = Query(None, max_length=200),
    include_inactive: bool = Query(False),
    limit: int = Query(300, ge=1, le=500),
    catalog_scope: Literal["tenant", "global"] = Query(
        "tenant",
        description="tenant: types enabled for your company (matrix). global: full catalog (edit permission).",
    ),
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    if catalog_scope == "global":
        active = getattr(current_user, "active_role", None)
        if not (
            has_permission(db, current_user.id, "lookups.blinds_types.edit", active_role=active)
            or has_permission(db, current_user.id, "lookups.edit", active_role=active)
        ):
            raise HTTPException(status_code=403, detail="Catalog scope global requires edit permission.")
    term = (search or "").strip()
    params: dict[str, Any] = {"company_id": str(cid), "limit": limit}
    if catalog_scope == "global":
        where = ["TRUE"]
        if not include_inactive:
            where.append("bt.active IS TRUE")
        if term:
            params["term"] = f"%{term}%"
            where.append("(bt.name ILIKE :term OR COALESCE(bt.aciklama,'') ILIKE :term)")
        w = " AND ".join(where)
        rows = db.execute(
            text(
                f"""
                SELECT bt.id, bt.name, bt.aciklama, bt.active, bt.sort_order
                FROM blinds_type bt
                WHERE {w}
                ORDER BY bt.sort_order ASC, bt.name ASC
                LIMIT :limit
                """
            ),
            params,
        ).mappings().all()
    else:
        where = [
            "EXISTS (",
            "  SELECT 1 FROM company_blinds_type_matrix m",
            "  WHERE m.blinds_type_id = bt.id AND m.company_id = CAST(:company_id AS uuid)",
            ")",
        ]
        if not include_inactive:
            where.append("bt.active IS TRUE")
        if term:
            params["term"] = f"%{term}%"
            where.append("(bt.name ILIKE :term OR COALESCE(bt.aciklama,'') ILIKE :term)")
        w = " AND ".join(where)
        rows = db.execute(
            text(
                f"""
                SELECT bt.id, bt.name, bt.aciklama, bt.active, bt.sort_order
                FROM blinds_type bt
                WHERE {w}
                ORDER BY bt.sort_order ASC, bt.name ASC
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
    current_user: Annotated[Users, Depends(require_permissions("lookups.blinds_types.edit", "lookups.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    nm = body.name.strip()
    exists_name = db.execute(
        text(
            """
            SELECT 1
            FROM blinds_type
            WHERE lower(btrim(name)) = lower(btrim(:name))
            LIMIT 1
            """
        ),
        {"name": nm},
    ).first()
    if exists_name:
        raise HTTPException(status_code=409, detail="A blinds type with this name already exists.")
    next_so = body.sort_order
    if next_so is None:
        next_so = int(
            db.execute(text("SELECT COALESCE(MAX(sort_order), -1) + 1 FROM blinds_type")).scalar() or 0
        )
    for _ in range(5):
        new_id = _new_row_id()
        exists = db.execute(text("SELECT 1 FROM blinds_type WHERE id = :id LIMIT 1"), {"id": new_id}).first()
        if exists:
            continue
        try:
            db.execute(
                text(
                    """
                    INSERT INTO blinds_type (id, name, aciklama, active, sort_order)
                    VALUES (:id, :name, :aciklama, TRUE, :sort_order)
                    """
                ),
                {
                    "id": new_id,
                    "name": nm,
                    "aciklama": _normalize_aciklama(body.aciklama),
                    "sort_order": next_so,
                },
            )
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=400, detail="Could not create blinds type.")
        row = db.execute(
            text(
                """
                SELECT id, name, aciklama, active, sort_order
                FROM blinds_type
                WHERE id = :id
                """
            ),
            {"id": new_id},
        ).mappings().one()
        return BlindsTypeOut(**dict(row))
    raise HTTPException(status_code=500, detail="Could not allocate id, try again.")


@router.patch("/blinds-types/{blinds_type_id}", response_model=BlindsTypeOut)
def patch_blinds_type(
    blinds_type_id: str,
    body: BlindsTypePatchIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("lookups.blinds_types.edit", "lookups.edit"))],
):
    if not effective_company_id(current_user):
        raise HTTPException(status_code=403, detail="No active company.")
    current = db.execute(
        text(
            """
            SELECT id, name, aciklama, active, sort_order
            FROM blinds_type
            WHERE id = :id
            """
        ),
        {"id": blinds_type_id},
    ).mappings().first()
    if not current:
        raise HTTPException(status_code=404, detail="Blinds type not found.")
    name = current["name"] if body.name is None else body.name.strip()
    if body.name is not None:
        exists_name = db.execute(
            text(
                """
                SELECT 1
                FROM blinds_type
                WHERE lower(btrim(name)) = lower(btrim(:name))
                  AND id <> :id
                LIMIT 1
                """
            ),
            {"name": name, "id": str(blinds_type_id).strip()},
        ).first()
        if exists_name:
            raise HTTPException(status_code=409, detail="A blinds type with this name already exists.")
    aciklama = current["aciklama"] if body.aciklama is None else _normalize_aciklama(body.aciklama)
    active = current["active"] if body.active is None else body.active
    sort_order = current["sort_order"] if body.sort_order is None else body.sort_order
    if body.active is False:
        used = db.execute(
            text(
                """
                SELECT 1
                FROM company_blinds_type_matrix
                WHERE blinds_type_id = :tid
                LIMIT 1
                """
            ),
            {"tid": str(blinds_type_id).strip()},
        ).first()
        if used:
            raise HTTPException(
                status_code=400,
                detail="This blinds type is enabled for at least one company. Disable it in the matrix first.",
            )
        referenced = db.execute(
            text(
                """
                SELECT 1
                FROM estimate_blinds eb
                WHERE eb.blinds_id = :tid
                LIMIT 1
                """
            ),
            {"tid": str(blinds_type_id).strip()},
        ).first()
        if referenced:
            raise HTTPException(
                status_code=400,
                detail="This blinds type is referenced by existing estimates. Update estimates before deactivating.",
            )
        referenced2 = db.execute(
            text(
                """
                SELECT 1
                FROM orders o
                WHERE COALESCE(o.active, TRUE) IS TRUE
                  AND EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(o.blinds_lines) AS x(elem)
                    WHERE (x.elem->>'id') = :tid
                  )
                LIMIT 1
                """
            ),
            {"tid": str(blinds_type_id).strip()},
        ).first()
        if referenced2:
            raise HTTPException(
                status_code=400,
                detail="This blinds type is referenced by existing orders. Update orders before deactivating.",
            )
    db.execute(
        text(
            """
            UPDATE blinds_type
            SET name = :name, aciklama = :aciklama, active = :active, sort_order = :sort_order
            WHERE id = :id
            """
        ),
        {
            "id": blinds_type_id,
            "name": name,
            "aciklama": aciklama,
            "active": active,
            "sort_order": sort_order,
        },
    )
    db.commit()
    row = db.execute(
        text(
            """
            SELECT id, name, aciklama, active, sort_order
            FROM blinds_type
            WHERE id = :id
            """
        ),
        {"id": blinds_type_id},
    ).mappings().one()
    return BlindsTypeOut(**dict(row))


# --- Order status (status_order) ---


class OrderStatusOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    active: bool
    sort_order: int = 0
    code: str | None = Field(
        default=None,
        description="builtin_kind when set (e.g. new|ready_for_install|in_production|done); null for custom labels.",
    )


@router.get("/order-statuses", response_model=list[OrderStatusOut])
def list_order_statuses(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("lookups.order_statuses.view", "lookups.view"))],
    search: str | None = Query(None, max_length=200),
    include_inactive: bool = Query(False),
    limit: int = Query(300, ge=1, le=500),
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    term = (search or "").strip()
    # Single predicate: do not split EXISTS across list items (join uses " AND ").
    where = [
        """
        EXISTS (
          SELECT 1 FROM company_status_order_matrix m
          WHERE m.company_id = CAST(:company_id AS uuid)
            AND m.status_order_id = so.id
        )
        """.strip(),
    ]
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
            SELECT so.id, so.name, so.active, so.sort_order, so.builtin_kind
            FROM status_order so
            WHERE {w}
            ORDER BY so.sort_order ASC, so.active DESC, so.name ASC
            LIMIT :limit
            """
        ),
        params,
    ).mappings().all()
    out: list[OrderStatusOut] = []
    for r in rows:
        d = dict(r)
        bk = d.pop("builtin_kind", None)
        d["code"] = str(bk).strip().lower() if bk else None
        out.append(OrderStatusOut(**d))
    return out


# --- Estimate status (status_estimate): same UX as order statuses; optional builtin_kind in DB (not "slug") ---


class EstimateStatusOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    active: bool
    sort_order: int = 0
    code: str | None = Field(
        default=None,
        description="new | pending | converted | cancelled for built-in rows; null for custom labels.",
    )


def _estimate_status_row_out(row: dict[str, Any]) -> EstimateStatusOut:
    d = dict(row)
    bk = d.pop("builtin_kind", None)
    d["code"] = str(bk).strip().lower() if bk else None
    return EstimateStatusOut(**d)


@router.get("/estimate-statuses", response_model=list[EstimateStatusOut])
def list_estimate_statuses(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("lookups.estimate_statuses.view", "lookups.view"))],
    search: str | None = Query(None, max_length=200),
    include_inactive: bool = Query(False),
    limit: int = Query(300, ge=1, le=500),
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    term = (search or "").strip()
    where = [
        """
        EXISTS (
          SELECT 1 FROM company_status_estimate_matrix m
          WHERE m.company_id = CAST(:company_id AS uuid)
            AND m.status_estimate_id = se.id
        )
        """.strip(),
    ]
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
            SELECT se.id, se.builtin_kind, se.name, se.active, se.sort_order
            FROM status_estimate se
            WHERE {w}
            ORDER BY se.sort_order ASC, se.active DESC, se.name ASC
            LIMIT :limit
            """
        ),
        params,
    ).mappings().all()
    return [_estimate_status_row_out(dict(r)) for r in rows]


from app.domains.business_lookups.api.blinds_product_categories import (  # noqa: E402
    router as _blinds_product_categories_router,
)

router.include_router(_blinds_product_categories_router)
