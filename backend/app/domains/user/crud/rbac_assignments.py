from typing import Any, Optional, TypedDict
from uuid import UUID

from fastapi.encoders import jsonable_encoder
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domains.lookup.models.roles import Roles
from app.domains.user.models.user_roles import UserRoles
from app.domains.user.models.users import Users


def _uuid_candidates(u: UUID) -> tuple[str, str]:
    return (str(u), u.hex)


def _resolve_user_id_string(db: Session, user_id: UUID) -> str | None:
    d, h = _uuid_candidates(user_id)
    row = db.execute(
        text("SELECT id FROM users WHERE id=:d OR id=:h LIMIT 1"),
        {"d": d, "h": h},
    ).first()
    return row[0] if row else None


def _resolve_role_id_string(db: Session, role_id: UUID) -> str | None:
    d, h = _uuid_candidates(role_id)
    row = db.execute(
        text("SELECT id FROM roles WHERE COALESCE(is_deleted,0)=0 AND (id=:d OR id=:h) LIMIT 1"),
        {"d": d, "h": h},
    ).first()
    return row[0] if row else None


def _parse_uuidish(s: str) -> UUID:
    s = (s or "").strip()
    if "-" in s:
        return UUID(s)
    return UUID(hex=s)


class _UserRoleRow(TypedDict):
    id: UUID
    user_id: UUID
    role_id: UUID
    created_at: Any
    is_deleted: bool


def _fetch_assignment_row(db: Session, assignment_id_str: str) -> _UserRoleRow | None:
    row = db.execute(
        text(
            "SELECT id, user_id, role_id, created_at, COALESCE(is_deleted,0) "
            "FROM user_roles WHERE id=:id LIMIT 1"
        ),
        {"id": assignment_id_str},
    ).first()
    if not row:
        return None
    return {
        "id": _parse_uuidish(str(row[0])),
        "user_id": _parse_uuidish(str(row[1])),
        "role_id": _parse_uuidish(str(row[2])),
        "created_at": row[3],
        "is_deleted": bool(row[4]),
    }


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


def is_bootstrap_superadmin_assignment(db: Session, ur: UserRoles) -> bool:
    """True when this row is the seeded superadmin user + superadmin role (SUPER_ADMIN_EMAIL)."""
    configured = (settings.super_admin_email or "").strip().lower()
    if not configured:
        return False
    # Avoid UUID representation mismatch (hex32 vs dashed36) by reading via JOIN.
    row = db.execute(
        text(
            "SELECT u.email, r.name "
            "FROM user_roles ur "
            "JOIN users u ON u.id = ur.user_id "
            "JOIN roles r ON r.id = ur.role_id "
            "WHERE ur.id = :id "
            "LIMIT 1"
        ),
        {"id": str(ur.id)},
    ).first()
    if not row:
        # Try hex32 form of id if stored without dashes.
        try:
            hid = UUID(str(ur.id)).hex
        except Exception:
            return False
        row = db.execute(
            text(
                "SELECT u.email, r.name "
                "FROM user_roles ur "
                "JOIN users u ON u.id = ur.user_id "
                "JOIN roles r ON r.id = ur.role_id "
                "WHERE ur.id = :id "
                "LIMIT 1"
            ),
            {"id": hid},
        ).first()
    if not row:
        return False
    email, role_name = row[0], row[1]
    if (role_name or "").strip().lower() != "superadmin":
        return False
    return (email or "").strip().lower() == configured


def assign_role(
    db: Session,
    *,
    user_id: UUID,
    role_id: UUID,
    actor_id: UUID,
) -> tuple[_UserRoleRow, bool, Optional[dict[str, Any]]]:
    """Atar veya silinmiş (soft) satırı yeniden etkinleştirir.

    Dönüş: (satır, reactivated_mi, audit_öncesi | None)
    """
    # MariaDB: tolerate mixed UUID storage (hex32 vs dashed36) by resolving stored id strings.
    uid = _resolve_user_id_string(db, user_id)
    if not uid:
        raise ValueError("user_or_role_not_found")
    # Ensure user is not deleted.
    if not db.execute(
        text("SELECT 1 FROM users WHERE id=:u AND COALESCE(is_deleted,0)=0 LIMIT 1"),
        {"u": uid},
    ).first():
        raise ValueError("user_or_role_not_found")

    rid = _resolve_role_id_string(db, role_id)
    if not rid:
        raise ValueError("user_or_role_not_found")

    actor = _resolve_user_id_string(db, actor_id)

    existing = db.execute(
        text(
            "SELECT id, COALESCE(is_deleted,0) AS is_deleted "
            "FROM user_roles WHERE user_id=:u AND role_id=:r LIMIT 1"
        ),
        {"u": uid, "r": rid},
    ).first()
    if existing:
        if not bool(existing[1]):
            raise ValueError("already_assigned")
        before = {"id": existing[0], "user_id": uid, "role_id": rid, "is_deleted": True}
        db.execute(
            text("UPDATE user_roles SET is_deleted=FALSE, updated_by=:a WHERE id=:id"),
            {"a": actor, "id": existing[0]},
        )
        db.commit()
        out = _fetch_assignment_row(db, str(existing[0]))
        if out is None:
            raise ValueError("user_or_role_not_found")
        return out, True, before

    # Insert
    new_id = db.execute(text("SELECT UUID()")).scalar()
    db.execute(
        text(
            "INSERT INTO user_roles (id, user_id, role_id, is_deleted, created_by, updated_by) "
            "VALUES (:id, :u, :r, FALSE, :a, :a)"
        ),
        {"id": new_id, "u": uid, "r": rid, "a": actor},
    )
    db.commit()
    out = _fetch_assignment_row(db, str(new_id))
    if out is None:
        raise ValueError("user_or_role_not_found")
    return out, False, None


def soft_delete_assignment(db: Session, assignment_id: UUID, *, actor_id: UUID) -> Optional[UserRoles]:
    row = get_assignment(db, assignment_id)
    if not row or row.is_deleted:
        return None
    row.is_deleted = True
    row.updated_by = actor_id
    db.commit()
    db.refresh(row)
    return row
