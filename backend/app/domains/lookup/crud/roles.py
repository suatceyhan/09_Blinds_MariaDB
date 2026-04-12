from typing import Any, Optional
from uuid import UUID

from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.core.authorization import is_effective_superadmin
from app.domains.lookup.models.roles import Roles
from app.domains.lookup.schemas.roles import RoleCreate, RoleUpdate


def list_roles(
    db: Session,
    *,
    actor_user_id: UUID,
    active_role: Optional[str] = None,
    skip: int = 0,
    limit: int = 100,
    name: Optional[str] = None,
    include_deleted: bool = False,
) -> list[Roles]:
    q = db.query(Roles)
    if not include_deleted:
        q = q.filter(Roles.is_deleted.is_(False))
    if not is_effective_superadmin(db, actor_user_id, active_role):
        q = q.filter(~Roles.name.ilike("superadmin"))
    if name:
        q = q.filter(Roles.name.ilike(f"%{name.strip()}%"))
    return q.order_by(Roles.is_deleted, Roles.name).offset(skip).limit(limit).all()


def get_role(db: Session, role_id: UUID) -> Optional[Roles]:
    return db.query(Roles).filter(Roles.id == role_id).first()


def create_role(
    db: Session, data: RoleCreate, *, created_by: UUID
) -> tuple[Roles, bool, Optional[dict[str, Any]]]:
    """Insert a role, or reactivate a soft-deleted row with the same name (unique on name).

    Returns (row, reactivated, audit_before_or_none).
    """
    name = data.name.strip()
    deleted = (
        db.query(Roles).filter(Roles.name == name, Roles.is_deleted.is_(True)).first()
    )
    if deleted:
        before = jsonable_encoder(deleted)
        deleted.description = data.description
        deleted.is_protected = data.is_protected
        deleted.role_group_id = data.role_group_id
        deleted.is_deleted = False
        deleted.updated_by = created_by
        db.commit()
        db.refresh(deleted)
        return deleted, True, before
    row = Roles(
        name=name,
        description=data.description,
        is_protected=data.is_protected,
        is_deleted=False,
        role_group_id=data.role_group_id,
        created_by=created_by,
        updated_by=created_by,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row, False, None


def update_role(db: Session, role_id: UUID, data: RoleUpdate, *, updated_by: UUID) -> Optional[Roles]:
    row = get_role(db, role_id)
    if not row:
        return None
    payload = data.model_dump(exclude_unset=True)
    if "name" in payload and payload["name"] is not None:
        payload["name"] = payload["name"].strip()
    for key, value in payload.items():
        setattr(row, key, value)
    row.updated_by = updated_by
    db.commit()
    db.refresh(row)
    return row


def soft_delete_role(db: Session, role_id: UUID, *, updated_by: UUID) -> Optional[Roles]:
    row = get_role(db, role_id)
    if not row:
        return None
    if row.is_protected:
        return None
    row.is_deleted = True
    row.updated_by = updated_by
    db.commit()
    db.refresh(row)
    return row
