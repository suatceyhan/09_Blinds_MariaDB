from __future__ import annotations

import secrets
from typing import Annotated, Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.authorization import has_permission
from app.core.database import get_db
from app.dependencies.auth import effective_company_id, require_permissions
from app.domains.business_lookups.services.blinds_catalog import load_allowed_category_ids_by_type
from app.domains.user.models.users import Users

router = APIRouter()


class BlindsProductCategoryOut(BaseModel):
    id: str
    name: str
    sort_order: int
    active: bool
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    blinds_type_ids: list[str] = Field(
        default_factory=list,
        description="Blinds types using this category in your company (read-only).",
    )


class BlindsProductCategoryCreate(BaseModel):
    id: Optional[str] = Field(
        default=None,
        max_length=32,
        description="Optional stable key stored on order lines (1–32 chars). If omitted, a random id is generated.",
    )
    name: str = Field(..., min_length=1, max_length=200)
    sort_order: int = Field(default=0, ge=0, le=999999)


class BlindsProductCategoryPatch(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    sort_order: Optional[int] = Field(default=None, ge=0, le=999999)
    active: Optional[bool] = None


def _map_row(row: Any) -> dict[str, Any]:
    d = dict(row._mapping if hasattr(row, "_mapping") else row)

    def iso(v: Any) -> Optional[str]:
        if v is None:
            return None
        try:
            return v.isoformat()
        except Exception:
            return str(v)

    d["created_at"] = iso(d.get("created_at"))
    d["updated_at"] = iso(d.get("updated_at"))
    return d


def _row_to_out(d: dict[str, Any], *, code_to_types: dict[str, list[str]]) -> dict[str, Any]:
    """DB column `code` is exposed as `id` in API responses."""
    raw = dict(d)
    code = raw.pop("code", None)
    if code is None and "id" in raw:
        code = raw["id"]
    if code is None:
        raise ValueError("expected code or id on row")
    raw["id"] = str(code)
    raw["blinds_type_ids"] = sorted(set(code_to_types.get(str(code), [])))
    return raw


@router.get("/blinds-product-categories", response_model=list[BlindsProductCategoryOut])
def list_blinds_product_categories(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("lookups.product_categories.view", "lookups.view"))],
    search: str | None = Query(None, max_length=200),
    include_inactive: bool = Query(False),
    limit: int = Query(300, ge=1, le=500),
    catalog_scope: Literal["tenant", "global"] = Query(
        "tenant",
        description="tenant: categories enabled for your company (matrix). global: full catalog (edit permission).",
    ),
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    if catalog_scope == "global":
        active = getattr(current_user, "active_role", None)
        if not (
            has_permission(db, current_user.id, "lookups.product_categories.edit", active_role=active)
            or has_permission(db, current_user.id, "lookups.edit", active_role=active)
        ):
            raise HTTPException(status_code=403, detail="Catalog scope global requires edit permission.")

    allowed_by_type = load_allowed_category_ids_by_type(db, cid)
    code_to_types: dict[str, list[str]] = {}
    for tid, codes in allowed_by_type.items():
        for c in codes:
            code_to_types.setdefault(c, []).append(tid)

    term = (search or "").strip()
    where: list[str] = []
    params: dict[str, Any] = {"limit": limit, "cid": str(cid)}
    if not include_inactive:
        where.append("pc.active IS TRUE")
    if term:
        params["term"] = f"%{term}%"
        where.append("(LOWER(pc.name) LIKE LOWER(:term) OR LOWER(pc.code) LIKE LOWER(:term))")
    wh_clause = f"WHERE {' AND '.join(where)}" if where else ""

    if catalog_scope == "global":
        sql = f"""
            SELECT pc.code, pc.name, pc.sort_order, pc.active, pc.created_at, pc.updated_at
            FROM blinds_product_category pc
            {wh_clause}
            ORDER BY pc.active DESC, pc.sort_order ASC, pc.name ASC
            LIMIT :limit
            """
    else:
        sql = f"""
            SELECT pc.code, pc.name, pc.sort_order, pc.active, pc.created_at, pc.updated_at
            FROM blinds_product_category pc
            INNER JOIN company_blinds_product_category_matrix m
              ON m.category_code = pc.code AND m.company_id = :cid
            {wh_clause}
            ORDER BY pc.active DESC, pc.sort_order ASC, pc.name ASC
            LIMIT :limit
            """

    rows = db.execute(text(sql), params).mappings().all()
    out: list[dict[str, Any]] = []
    for r in rows:
        d = _map_row(r)
        out.append(_row_to_out(d, code_to_types=code_to_types))
    return out


def _insert_category(
    db: Session,
    *,
    code: str,
    name: str,
    sort_order: int,
) -> dict[str, Any] | None:
    return db.execute(
        text(
            """
            INSERT INTO blinds_product_category (code, name, sort_order, active, created_at, updated_at)
            VALUES (:code, :name, :ord, TRUE, NOW(), NOW())
            ON CONFLICT (code) DO NOTHING
            RETURNING code, name, sort_order, active, created_at, updated_at
            """
        ),
        {"code": code, "name": name, "ord": sort_order},
    ).mappings().first()


@router.post("/blinds-product-categories", response_model=BlindsProductCategoryOut)
def create_blinds_product_category(
    body: BlindsProductCategoryCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("lookups.product_categories.edit", "lookups.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    name = body.name.strip()
    exists_name = db.execute(
        text(
            """
            SELECT 1
            FROM blinds_product_category
            WHERE lower(trim(name)) = lower(trim(:name))
            LIMIT 1
            """
        ),
        {"name": name},
    ).first()
    if exists_name:
        raise HTTPException(status_code=409, detail="A product category with this name already exists.")
    explicit = (body.id or "").strip()
    if explicit:
        cid_key = explicit.lower()
        if len(cid_key) > 32 or len(cid_key) < 1:
            raise HTTPException(status_code=400, detail="id must be between 1 and 32 characters.")
        row = _insert_category(db, code=cid_key, name=name, sort_order=body.sort_order)
        if not row:
            raise HTTPException(status_code=409, detail="A category with this id already exists.")
    else:
        row = None
        for _ in range(12):
            cid_key = secrets.token_hex(8)
            row = _insert_category(db, code=cid_key, name=name, sort_order=body.sort_order)
            if row:
                break
        if not row:
            raise HTTPException(status_code=500, detail="Could not allocate a unique category id.")
    db.commit()
    r = _map_row(row)
    return _row_to_out(r, code_to_types={})


@router.patch("/blinds-product-categories/{category_id}", response_model=BlindsProductCategoryOut)
def patch_blinds_product_category(
    category_id: str,
    body: BlindsProductCategoryPatch,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("lookups.product_categories.edit", "lookups.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    code = category_id.strip().lower()
    if not code:
        raise HTTPException(status_code=400, detail="Invalid id.")
    row = db.execute(
        text(
            """
            SELECT code, name, sort_order, active, created_at, updated_at
            FROM blinds_product_category
            WHERE code = :code
            """
        ),
        {"code": code},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Category not found.")

    name = body.name.strip() if body.name is not None else row["name"]
    if body.name is not None:
        exists_name = db.execute(
            text(
                """
                SELECT 1
                FROM blinds_product_category
                WHERE lower(trim(name)) = lower(trim(:name))
                  AND code <> :code
                LIMIT 1
                """
            ),
            {"name": name, "code": code},
        ).first()
        if exists_name:
            raise HTTPException(status_code=409, detail="A product category with this name already exists.")
    sort_order = body.sort_order if body.sort_order is not None else row["sort_order"]
    active = row["active"] if body.active is None else body.active

    if body.active is False:
        # Block deactivation if enabled for any company or referenced by existing orders.
        used = db.execute(
            text(
                """
                SELECT 1
                FROM company_blinds_product_category_matrix
                WHERE category_code = :code
                LIMIT 1
                """
            ),
            {"code": code},
        ).first()
        if used:
            raise HTTPException(
                status_code=400,
                detail="This category is enabled for at least one company. Disable it in the matrix first.",
            )
        referenced = db.execute(
            text(
                """
                SELECT 1
                FROM orders o
                WHERE COALESCE(o.active, TRUE) IS TRUE
                  AND EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(o.blinds_lines) AS x(elem)
                    WHERE lower(COALESCE(x.elem->>'category','')) = :code
                  )
                LIMIT 1
                """
            ),
            {"code": code},
        ).first()
        if referenced:
            raise HTTPException(
                status_code=400,
                detail="This category is referenced by existing orders. Update orders to remove it before deactivating.",
            )
        db.execute(
            text("DELETE FROM blinds_type_category_allowed WHERE category_code = :code"),
            {"code": code},
        )

    db.execute(
        text(
            """
            UPDATE blinds_product_category
            SET name = :name, sort_order = :ord, active = :active, updated_at = NOW()
            WHERE code = :code
            """
        ),
        {"name": name, "ord": sort_order, "active": active, "code": code},
    )
    db.commit()

    row2 = db.execute(
        text(
            """
            SELECT code, name, sort_order, active, created_at, updated_at
            FROM blinds_product_category
            WHERE code = :code
            """
        ),
        {"code": code},
    ).mappings().first()
    allowed_by_type = load_allowed_category_ids_by_type(db, cid)
    code_to_types: dict[str, list[str]] = {}
    for tid, codes in allowed_by_type.items():
        for c in codes:
            code_to_types.setdefault(c, []).append(tid)
    r = _map_row(row2)
    return _row_to_out(r, code_to_types=code_to_types)


@router.delete("/blinds-product-categories/{category_id}")
def delete_blinds_product_category(
    category_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("lookups.product_categories.edit", "lookups.edit"))],
):
    """Soft-deactivate; clears type×category links for all companies (same as PATCH active=false)."""
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    code = category_id.strip().lower()
    row = db.execute(
        text("SELECT code FROM blinds_product_category WHERE code = :code"),
        {"code": code},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Category not found.")

    used = db.execute(
        text(
            """
            SELECT 1
            FROM company_blinds_product_category_matrix
            WHERE category_code = :code
            LIMIT 1
            """
        ),
        {"code": code},
    ).first()
    if used:
        raise HTTPException(
            status_code=400,
            detail="This category is enabled for at least one company. Disable it in the matrix first.",
        )
    referenced = db.execute(
        text(
            """
            SELECT 1
            FROM orders o
            WHERE COALESCE(o.active, TRUE) IS TRUE
              AND EXISTS (
                SELECT 1
                FROM jsonb_array_elements(o.blinds_lines) AS x(elem)
                WHERE lower(COALESCE(x.elem->>'category','')) = :code
              )
            LIMIT 1
            """
        ),
        {"code": code},
    ).first()
    if referenced:
        raise HTTPException(
            status_code=400,
            detail="This category is referenced by existing orders. Update orders to remove it before deactivating.",
        )

    db.execute(
        text("DELETE FROM blinds_type_category_allowed WHERE category_code = :code"),
        {"code": code},
    )
    db.execute(
        text(
            """
            UPDATE blinds_product_category
            SET active = FALSE, updated_at = NOW()
            WHERE code = :code
            """
        ),
        {"code": code},
    )
    db.commit()
    return {"ok": True}
