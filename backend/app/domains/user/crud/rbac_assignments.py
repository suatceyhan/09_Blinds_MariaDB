from typing import Any, Optional
from uuid import UUID

from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.domains.lookup.models.roles import Roles
from app.domains.user.models.user_roles import UserRoles
from app.domains.user.models.users import Users


def list_assignments(db: Session, *, skip: int = 0, limit: int = 50) -> list[UserRoles]:
    return (
        db.query(UserRoles)
        .filter(UserRoles.is_deleted.is_(False))
        .order_by(UserRoles.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


def list_assignments_with_labels(
    db: Session,
    *,
    skip: int = 0,
    limit: int = 50,
    include_deleted: bool = False,
) -> list[tuple[UserRoles, str, str]]:
    """(UserRoles, user_email, role_name)."""
    q = (
        db.query(UserRoles, Users.email, Roles.name)
        .join(Users, Users.id == UserRoles.user_id)
        .join(Roles, Roles.id == UserRoles.role_id)
    )
    if not include_deleted:
        q = q.filter(UserRoles.is_deleted.is_(False))
    return (
        q.order_by(UserRoles.is_deleted, UserRoles.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


def get_assignment(db: Session, assignment_id: UUID) -> Optional[UserRoles]:
    return db.query(UserRoles).filter(UserRoles.id == assignment_id).first()


def assign_role(
    db: Session,
    *,
    user_id: UUID,
    role_id: UUID,
    actor_id: UUID,
) -> tuple[UserRoles, bool, Optional[dict[str, Any]]]:
    """Atar veya silinmiş (soft) satırı yeniden etkinleştirir.

    Dönüş: (satır, reactivated_mi, audit_öncesi | None)
    """
    user = db.query(Users).filter(Users.id == user_id, Users.is_deleted.is_(False)).first()
    role = db.query(Roles).filter(Roles.id == role_id, Roles.is_deleted.is_(False)).first()
    if not user or not role:
        raise ValueError("user_or_role_not_found")
    existing = (
        db.query(UserRoles)
        .filter(
            UserRoles.user_id == user_id,
            UserRoles.role_id == role_id,
        )
        .first()
    )
    if existing:
        if not existing.is_deleted:
            raise ValueError("already_assigned")
        before = jsonable_encoder(existing)
        existing.is_deleted = False
        existing.updated_by = actor_id
        db.commit()
        db.refresh(existing)
        return existing, True, before
    row = UserRoles(
        user_id=user_id,
        role_id=role_id,
        is_deleted=False,
        created_by=actor_id,
        updated_by=actor_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row, False, None


def soft_delete_assignment(db: Session, assignment_id: UUID, *, actor_id: UUID) -> Optional[UserRoles]:
    row = get_assignment(db, assignment_id)
    if not row or row.is_deleted:
        return None
    row.is_deleted = True
    row.updated_by = actor_id
    db.commit()
    db.refresh(row)
    return row
