import secrets
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import text
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from app.core.database import get_db
from app.core.person_names import format_person_name_casing
from app.dependencies.auth import effective_company_id, require_permissions, resolve_tenant_company_id
from app.domains.user.models.users import Users


router = APIRouter(prefix="/customers", tags=["Customers"])


def _new_customer_id() -> str:
    # 16 hex chars, fits customers.id VARCHAR(16)
    return secrets.token_hex(8)


class CustomerListItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: UUID
    name: str
    surname: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    postal_code: str | None = None
    active: bool
    created_at: Any | None = None
    updated_at: Any | None = None


class CustomerOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: UUID
    name: str
    surname: str | None = None
    phone: str | None = None
    email: str | None = None
    address: str | None = None
    postal_code: str | None = None
    status_user_id: str | None = None
    active: bool
    created_at: Any | None = None
    updated_at: Any | None = None
    estimates: list[dict[str, Any]] = []
    orders: list[dict[str, Any]] = []


class CustomerCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=500)
    surname: str | None = Field(None, max_length=500)
    phone: str | None = Field(None, max_length=100)
    email: EmailStr | None = None
    address: str | None = Field(None, max_length=2000)
    postal_code: str | None = Field(None, max_length=32)
    status_user_id: str | None = Field(None, max_length=16)


class CustomerPatchIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str | None = Field(None, min_length=1, max_length=500)
    surname: str | None = Field(None, max_length=500)
    phone: str | None = Field(None, max_length=100)
    email: EmailStr | None = None
    address: str | None = Field(None, max_length=2000)
    postal_code: str | None = Field(None, max_length=32)
    status_user_id: str | None = Field(None, max_length=16)
    active: bool | None = None


@router.get("", response_model=list[CustomerListItemOut])
def list_customers(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("customers.view"))],
    limit: int = Query(200, ge=1, le=500),
    search: str | None = Query(None, max_length=200),
    include_inactive: bool = Query(False),
    company_id: UUID | None = Query(None),
):
    tenant_cid = resolve_tenant_company_id(db, current_user, company_id_param=company_id)

    term = (search or "").strip()
    where = ["c.company_id = CAST(:tenant_cid AS uuid)"]
    params: dict[str, Any] = {"limit": limit, "tenant_cid": str(tenant_cid)}
    if not include_inactive:
        where.append("c.active IS TRUE")
    if term:
        params["term"] = f"%{term}%"
        where.append(
            "("
            "c.name ILIKE :term OR COALESCE(c.surname,'') ILIKE :term OR COALESCE(c.phone,'') ILIKE :term OR "
            "COALESCE(c.email,'') ILIKE :term OR COALESCE(c.address,'') ILIKE :term OR "
            "COALESCE(c.postal_code,'') ILIKE :term"
            ")"
        )

    where_sql = f"WHERE {' AND '.join(where)}" if where else ""
    rows = db.execute(
        text(
            f"""
            SELECT
              c.company_id,
              c.id,
              c.name,
              c.surname,
              c.phone,
              c.email,
              c.address,
              c.postal_code,
              c.active,
              c.created_at,
              c.updated_at
            FROM customers c
            {where_sql}
            ORDER BY c.created_at DESC NULLS LAST
            LIMIT :limit
            """
        ),
        params,
    ).mappings().all()
    return [CustomerListItemOut(**dict(r)) for r in rows]


@router.post("", response_model=CustomerOut, status_code=status.HTTP_201_CREATED)
def create_customer(
    body: CustomerCreateIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("customers.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")

    for _ in range(5):
        new_id = _new_customer_id()
        exists = db.execute(
            text("SELECT 1 FROM customers WHERE company_id = :cid AND id = :id LIMIT 1"),
            {"cid": str(cid), "id": new_id},
        ).first()
        if exists:
            continue
        db.execute(
            text(
                """
                INSERT INTO customers (
                  company_id, id, name, surname, phone, email, address, postal_code, status_user_id, active
                )
                VALUES (:cid, :id, :name, :surname, :phone, :email, :address, :postal_code, :status_user_id, TRUE)
                """
            ),
            {
                "cid": str(cid),
                "id": new_id,
                "name": format_person_name_casing(body.name.strip()) or body.name.strip(),
                "surname": format_person_name_casing(
                    body.surname.strip() if body.surname and body.surname.strip() else None
                ),
                "phone": (body.phone.strip() if body.phone and body.phone.strip() else None),
                "email": (str(body.email).strip() if body.email else None),
                "address": (body.address.strip() if body.address and body.address.strip() else None),
                "postal_code": (body.postal_code.strip() if body.postal_code and body.postal_code.strip() else None),
                "status_user_id": (
                    body.status_user_id.strip() if body.status_user_id and body.status_user_id.strip() else None
                ),
            },
        )
        db.commit()
        return get_customer(customer_id=new_id, db=db, current_user=current_user)

    raise HTTPException(status_code=500, detail="Could not allocate customer id, try again.")


@router.get("/{customer_id}", response_model=CustomerOut)
def get_customer(
    customer_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("customers.view"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    row = db.execute(
        text(
            """
            SELECT
              company_id, id, name, surname, phone, email, address, postal_code,
              status_user_id, active, created_at, updated_at
            FROM customers
            WHERE company_id = :company_id AND id = :id
            LIMIT 1
            """
        ),
        {"company_id": str(cid), "id": customer_id},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Customer not found.")
    # linked estimates/orders (simple list for now)
    estimates = db.execute(
        text(
            """
            SELECT
              e.id,
              e.tarih_saat,
              e.scheduled_start_at,
              se.builtin_kind AS status,
              COALESCE(NULLIF(trim(se.name), ''), '—') AS status_label,
              COALESCE(
                (
                  SELECT string_agg(
                    CASE
                      WHEN eb.perde_sayisi IS NOT NULL THEN bt.name || ' (' || eb.perde_sayisi::text || ')'
                      ELSE bt.name
                    END,
                    ', ' ORDER BY eb.sort_order, bt.name
                  )
                  FROM estimate_blinds eb
                  JOIN blinds_type bt ON bt.id = eb.blinds_id
                  WHERE eb.company_id = e.company_id AND eb.estimate_id = e.id
                ),
                (
                  SELECT CASE
                    WHEN e.perde_sayisi IS NOT NULL THEN bt.name || ' (' || e.perde_sayisi::text || ')'
                    ELSE bt.name
                  END
                  FROM blinds_type bt
                  WHERE bt.id = e.blinds_id
                  LIMIT 1
                )
              ) AS blinds_summary
            FROM estimate e
            LEFT JOIN status_estimate se ON se.id = e.status_esti_id
            WHERE e.company_id = :company_id AND e.customer_id = :cid AND e.is_deleted IS NOT TRUE
            ORDER BY COALESCE(e.scheduled_start_at, e.tarih_saat) DESC NULLS LAST
            LIMIT 50
            """
        ),
        {"company_id": str(cid), "cid": customer_id},
    ).mappings().all()
    orders = db.execute(
        text(
            """
            SELECT id, created_at, status_code, status_orde_id, total_amount, balance
            FROM orders
            WHERE company_id = :company_id AND customer_id = :cid
            ORDER BY created_at DESC NULLS LAST
            LIMIT 50
            """
        ),
        {"company_id": str(cid), "cid": customer_id},
    ).mappings().all()
    return CustomerOut(**dict(row), estimates=[dict(x) for x in estimates], orders=[dict(x) for x in orders])


@router.patch("/{customer_id}", response_model=CustomerOut)
def patch_customer(
    customer_id: str,
    body: CustomerPatchIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("customers.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    raw = body.model_dump(exclude_unset=True)
    if not raw:
        return get_customer(customer_id=customer_id, db=db, current_user=current_user)

    sets = []
    params: dict[str, Any] = {"id": customer_id}
    for key in ("name", "surname", "phone", "email", "address", "postal_code", "status_user_id", "active"):
        if key not in raw:
            continue
        v = raw.get(key)
        if isinstance(v, str):
            v = v.strip()
            if v == "":
                v = None
            elif key == "name" and v is not None:
                v = format_person_name_casing(v) or v
            elif key == "surname" and v is not None:
                v = format_person_name_casing(v)
        sets.append(f"{key} = :{key}")
        params[key] = v
    sets.append("updated_at = NOW()")
    if not sets:
        return get_customer(customer_id=customer_id, db=db, current_user=current_user)

    res = db.execute(
        text(
            f"""
            UPDATE customers
            SET {', '.join(sets)}
            WHERE company_id = :company_id AND id = :id
            """
        ),
        {**params, "company_id": str(cid)},
    )
    if res.rowcount == 0:
        db.rollback()
        raise HTTPException(status_code=404, detail="Customer not found.")
    db.commit()
    return get_customer(customer_id=customer_id, db=db, current_user=current_user)


@router.delete("/{customer_id}", response_model=CustomerOut)
def deactivate_customer(
    customer_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("customers.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    cust = customer_id.strip()
    active_orders = db.execute(
        text(
            """
            SELECT COUNT(*)::int AS c
            FROM orders
            WHERE company_id = CAST(:company_id AS uuid) AND customer_id = :customer_id AND active IS TRUE
            """
        ),
        {"company_id": str(cid), "customer_id": cust},
    ).mappings().first()
    if active_orders and (active_orders["c"] or 0) > 0:
        raise HTTPException(
            status_code=400,
            detail=(
                "Cannot deactivate this customer while they have active orders. "
                "Deactivate or resolve those orders first."
            ),
        )
    open_estimates = db.execute(
        text(
            """
            SELECT COUNT(*)::int AS c
            FROM estimate e
            JOIN status_estimate se ON se.id = e.status_esti_id
            WHERE e.company_id = CAST(:company_id AS uuid)
              AND e.customer_id = :customer_id
              AND e.is_deleted IS NOT TRUE
              AND se.builtin_kind IN ('new', 'pending')
            """
        ),
        {"company_id": str(cid), "customer_id": cust},
    ).mappings().first()
    if open_estimates and (open_estimates["c"] or 0) > 0:
        raise HTTPException(
            status_code=400,
            detail=(
                "Cannot deactivate this customer while they have open estimates "
                "(status New or Pending). Convert them to an order, cancel them, "
                "or remove them from the list first."
            ),
        )
    res = db.execute(
        text(
            "UPDATE customers SET active = FALSE, updated_at = NOW() WHERE company_id = :company_id AND id = :id"
        ),
        {"company_id": str(cid), "id": cust},
    )
    if res.rowcount == 0:
        db.rollback()
        raise HTTPException(status_code=404, detail="Customer not found.")
    db.commit()
    return get_customer(customer_id=customer_id, db=db, current_user=current_user)


@router.post("/{customer_id}/restore", response_model=CustomerOut)
def restore_customer(
    customer_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("customers.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    res = db.execute(
        text(
            "UPDATE customers SET active = TRUE, updated_at = NOW() WHERE company_id = :company_id AND id = :id"
        ),
        {"company_id": str(cid), "id": customer_id},
    )
    if res.rowcount == 0:
        db.rollback()
        raise HTTPException(status_code=404, detail="Customer not found.")
    db.commit()
    return get_customer(customer_id=customer_id, db=db, current_user=current_user)

