from typing import Optional
from uuid import UUID

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.domains.lookup.models.permissions import Permissions
from app.domains.lookup.schemas.permissions import PermissionCreate


def list_permissions(
    db: Session,
    *,
    skip: int = 0,
    limit: int = 500,
    name: Optional[str] = None,
) -> list[Permissions]:
    q = db.query(Permissions).filter(Permissions.is_deleted.is_(False))
    if name:
        term = f"%{name.strip()}%"
        q = q.filter(
            or_(Permissions.name.ilike(term), Permissions.key.ilike(term)),
        )
    return q.order_by(Permissions.sort_index, Permissions.key).offset(skip).limit(limit).all()


def get_permission(db: Session, permission_id: UUID) -> Optional[Permissions]:
    return db.query(Permissions).filter(Permissions.id == permission_id).first()


def get_permission_by_key(db: Session, key: str) -> Optional[Permissions]:
    return (
        db.query(Permissions)
        .filter(Permissions.key == key.strip(), Permissions.is_deleted.is_(False))
        .first()
    )


def create_permission(db: Session, data: PermissionCreate, *, created_by: UUID) -> Permissions:
    row = Permissions(
        key=data.key.strip(),
        name=data.name.strip(),
        parent_key=data.parent_key.strip() if data.parent_key else None,
        target_type=data.target_type.strip(),
        target_id=data.target_id.strip(),
        action=data.action.strip(),
        module_name=data.module_name.strip() if data.module_name else None,
        route_path=data.route_path.strip() if data.route_path else None,
        lookup_key=data.lookup_key.strip() if data.lookup_key else None,
        sort_index=data.sort_index,
        is_deleted=False,
        created_by=created_by,
        updated_by=created_by,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
