# PolicyEngine / RBAC — Users ve lookup modelleriyle kullanılır

from __future__ import annotations

import logging
from typing import List, Optional, Set
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app.domains.lookup.models.permissions import Permissions
from app.domains.lookup.models.roles import Roles
from app.domains.user.models.role_permissions import RolePermissions
from app.domains.user.models.user_permissions import UserPermissions
from app.domains.user.models.user_roles import UserRoles
from app.domains.user.models.users import Users

logger = logging.getLogger(__name__)

ROLE_HIERARCHY = {
    "superadmin": 3,
    "admin": 2,
    "roleadmin": 1,
    "employee": 0,
    "user": 0,
}

PROTECTED_ROLES = {"superadmin", "admin", "roleadmin"}


def _uuid_candidates(u: UUID) -> tuple[str, str]:
    """Return dashed36 and hex32 candidates for mixed MariaDB storage."""
    return (str(u), u.hex)


def user_has_superadmin_assignment(db: Session, user_id: UUID) -> bool:
    """Kullanıcıya atanmış (silinmemiş) superadmin rolü var mı."""
    d, h = _uuid_candidates(user_id)
    row = db.execute(
        text(
            "SELECT 1 "
            "FROM user_roles ur "
            "JOIN roles r ON r.id = ur.role_id "
            "WHERE COALESCE(ur.is_deleted,0)=0 AND COALESCE(r.is_deleted,0)=0 "
            "AND LOWER(r.name)='superadmin' "
            "AND (ur.user_id = :d OR ur.user_id = :h) "
            "LIMIT 1"
        ),
        {"d": d, "h": h},
    ).first()
    return row is not None


def is_effective_superadmin(
    db: Session, user_id: UUID, active_role: Optional[str]
) -> bool:
    """Aktif JWT rolü superadmin değilse (admin/user vb.) supert yetkiler uygulanmaz.

    active_role boş/None: eski token uyumu — atama varsa superadmin kabul edilir.
    """
    if not user_has_superadmin_assignment(db, user_id):
        return False
    if active_role is None or not str(active_role).strip():
        return True
    return str(active_role).strip().lower() == "superadmin"


def resolve_role_by_active_name(db: Session, active_role: Optional[str]) -> Optional[Roles]:
    """JWT / switch-role ile gelen rol adını DB'deki kayıtla büyük-küçük harf duyarsız eşle."""
    if active_role is None:
        return None
    name = str(active_role).strip()
    if not name:
        return None
    return (
        db.query(Roles)
        .filter(
            func.lower(Roles.name) == name.lower(),
            Roles.is_deleted.is_(False),
        )
        .first()
    )


class PolicyEngine:
    def has_permission(self, db, user_id, permission_key, active_role=None):
        return _rbac_has_permission(db, user_id, permission_key, active_role)


def _check_superadmin_permission(
    db: Session, user_id: UUID, active_role: Optional[str] = None
) -> bool:
    ar = str(active_role).strip().lower() if active_role else ""
    if ar == "superadmin":
        return True
    if ar:
        # JWT ile başka bir aktif rol seçiliyken hesaptaki superadmin ataması yetkiyi genişletmez.
        return False
    d, h = _uuid_candidates(user_id)
    row = db.execute(
        text(
            "SELECT 1 "
            "FROM user_roles ur "
            "JOIN roles r ON r.id = ur.role_id "
            "WHERE COALESCE(ur.is_deleted,0)=0 AND COALESCE(r.is_deleted,0)=0 "
            "AND LOWER(r.name) LIKE '%superadmin%' "
            "AND (ur.user_id = :d OR ur.user_id = :h) "
            "LIMIT 1"
        ),
        {"d": d, "h": h},
    ).first()
    return row is not None


def _check_active_role_permission(
    db: Session, user_id: UUID, permission_key: str, active_role: str
) -> bool:
    # Resolve role id string from DB to match stored representation.
    rrow = db.execute(
        text(
            "SELECT id FROM roles WHERE LOWER(name)=LOWER(:n) AND COALESCE(is_deleted,0)=0 LIMIT 1"
        ),
        {"n": str(active_role).strip()},
    ).first()
    if not rrow:
        return False
    role_id = rrow[0]
    d, h = _uuid_candidates(user_id)

    up = db.execute(
        text(
            "SELECT up.is_granted "
            "FROM user_permissions up "
            "JOIN permissions p ON p.id = up.permission_id "
            "WHERE COALESCE(up.is_deleted,0)=0 AND COALESCE(p.is_deleted,0)=0 "
            "AND up.role_id = :rid "
            "AND (up.user_id = :d OR up.user_id = :h) "
            "AND p.`key` = :k "
            "LIMIT 1"
        ),
        {"rid": role_id, "d": d, "h": h, "k": permission_key},
    ).first()
    if up is not None:
        return bool(up[0])

    rp = db.execute(
        text(
            "SELECT 1 "
            "FROM role_permissions rp "
            "JOIN permissions p ON p.id = rp.permission_id "
            "WHERE COALESCE(rp.is_deleted,0)=0 AND COALESCE(p.is_deleted,0)=0 "
            "AND COALESCE(rp.is_granted,0)=1 "
            "AND rp.role_id = :rid "
            "AND p.`key` = :k "
            "LIMIT 1"
        ),
        {"rid": role_id, "k": permission_key},
    ).first()
    return rp is not None


def _check_legacy_permissions(db: Session, user_id: UUID, permission_key: str) -> bool:
    # Legacy path: gather effective permission keys via raw SQL to tolerate mixed UUID storage.
    d, h = _uuid_candidates(user_id)

    # superAdmin legacy casing
    legacy_super = db.execute(
        text(
            "SELECT 1 FROM user_roles ur "
            "JOIN roles r ON r.id = ur.role_id "
            "WHERE COALESCE(ur.is_deleted,0)=0 AND COALESCE(r.is_deleted,0)=0 "
            "AND r.name = 'superAdmin' AND (ur.user_id=:d OR ur.user_id=:h) LIMIT 1"
        ),
        {"d": d, "h": h},
    ).first()
    if legacy_super:
        return True

    role_ids = [
        rid
        for (rid,) in db.execute(
            text(
                "SELECT role_id FROM user_roles "
                "WHERE COALESCE(is_deleted,0)=0 AND (user_id=:d OR user_id=:h)"
            ),
            {"d": d, "h": h},
        ).fetchall()
    ]

    perm_ids: set[str] = set(
        pid
        for (pid,) in db.execute(
            text(
                "SELECT permission_id FROM user_permissions "
                "WHERE COALESCE(is_deleted,0)=0 AND COALESCE(is_granted,0)=1 "
                "AND (user_id=:d OR user_id=:h)"
            ),
            {"d": d, "h": h},
        ).fetchall()
    )

    if role_ids:
        # IN list via bound params
        params = {f"r{i}": r for i, r in enumerate(role_ids)}
        in_clause = ", ".join([f":r{i}" for i in range(len(role_ids))])
        rows = db.execute(
            text(
                f"SELECT permission_id FROM role_permissions "
                f"WHERE COALESCE(is_deleted,0)=0 AND COALESCE(is_granted,0)=1 "
                f"AND role_id IN ({in_clause})"
            ),
            params,
        ).fetchall()
        perm_ids.update(pid for (pid,) in rows)

    if not perm_ids:
        return False

    params = {f"p{i}": p for i, p in enumerate(sorted(perm_ids))}
    in_clause = ", ".join([f":p{i}" for i in range(len(params))])
    keys = [
        k
        for (k,) in db.execute(
            text(
                f"SELECT `key` FROM permissions WHERE COALESCE(is_deleted,0)=0 AND id IN ({in_clause})"
            ),
            params,
        ).fetchall()
    ]
    key_set = set(keys)
    if permission_key in key_set:
        return True

    # Walk parent chain.
    hierarchy = db.execute(
        text("SELECT `key`, parent_key FROM permissions WHERE COALESCE(is_deleted,0)=0")
    ).fetchall()
    parent = {k: pk for (k, pk) in hierarchy if k}
    current = parent.get(permission_key)
    while current:
        if current in key_set:
            return True
        current = parent.get(current)
    return False


def _rbac_has_permission(
    db: Session, user_id: UUID, permission_key: str, active_role: Optional[str] = None
) -> bool:
    logger.debug(
        "has_permission user_id=%s permission_key=%s active_role=%s",
        user_id,
        permission_key,
        active_role,
    )
    if _check_superadmin_permission(db, user_id, active_role):
        return True
    if active_role:
        return _check_active_role_permission(db, user_id, permission_key, active_role)
    return _check_legacy_permissions(db, user_id, permission_key)


def has_permission(
    db: Session, user_id: UUID, permission_key: str, active_role: Optional[str] = None
) -> bool:
    return PolicyEngine().has_permission(db, user_id, permission_key, active_role=active_role)


def enforce_permission(
    db: Session, user_id: UUID, permission_name: str, active_role: Optional[str] = None
):
    if not has_permission(db, user_id, permission_name, active_role):
        raise HTTPException(
            status_code=403,
            detail=f"You do not have permission to perform this action: '{permission_name}'",
        )


def get_user_permissions(
    db: Session, user_id: UUID, active_role: Optional[str] = None
) -> List[str]:
    # If the account has superadmin assignment and no explicit active_role override,
    # treat as full-access (UI nav relies on permissions list).
    if not active_role and _check_superadmin_permission(db, user_id, active_role=None):
        all_perms = db.query(Permissions.key).filter(Permissions.is_deleted.is_(False)).all()
        return [row[0] for row in all_perms]
    if active_role and active_role.lower() == "superadmin":
        all_perms = db.query(Permissions.key).filter(Permissions.is_deleted.is_(False)).all()
        return [row[0] for row in all_perms]
    if active_role:
        role_obj = resolve_role_by_active_name(db, active_role)
        if not role_obj:
            return []
        role_id = role_obj.id
        role_keys = {
            row[0]
            for row in (
                db.query(Permissions.key)
                .select_from(RolePermissions)
                .join(Permissions, RolePermissions.permission_id == Permissions.id)
                .filter(
                    RolePermissions.role_id == role_id,
                    RolePermissions.is_granted.is_(True),
                    RolePermissions.is_deleted.is_(False),
                )
                .all()
            )
        }
        overrides = (
            db.query(Permissions.key, UserPermissions.is_granted)
            .select_from(UserPermissions)
            .join(Permissions, UserPermissions.permission_id == Permissions.id)
            .filter(
                UserPermissions.user_id == user_id,
                UserPermissions.role_id == role_id,
                UserPermissions.is_deleted.is_(False),
            )
            .all()
        )
        override_map = {key: bool(granted) for key, granted in overrides}
        effective: Set[str] = set()
        for key in role_keys | set(override_map.keys()):
            if key in override_map:
                if override_map[key]:
                    effective.add(key)
            elif key in role_keys:
                effective.add(key)
        return sorted(effective)
    direct = (
        db.query(Permissions.key)
        .select_from(UserPermissions)
        .join(Permissions, UserPermissions.permission_id == Permissions.id)
        .filter(
            UserPermissions.user_id == user_id,
            UserPermissions.is_deleted.is_(False),
            UserPermissions.is_granted.is_(True),
        )
        .all()
    )
    # Avoid SAWarning: IN (subquery) should receive a select()
    role_ids = select(UserRoles.role_id).where(
        UserRoles.user_id == user_id, UserRoles.is_deleted.is_(False)
    )
    via_roles = (
        db.query(Permissions.key)
        .select_from(RolePermissions)
        .join(Permissions, RolePermissions.permission_id == Permissions.id)
        .filter(
            RolePermissions.role_id.in_(role_ids),
            RolePermissions.is_granted.is_(True),
            RolePermissions.is_deleted.is_(False),
        )
        .all()
    )
    return list({row[0] for row in (direct + via_roles)})


def get_user_roles_and_group(db: Session, user_id: UUID) -> tuple[Set[str], UUID | None]:
    user = db.query(Users.id, Users.role_group_id).filter(Users.id == user_id).first()
    if not user:
        return set(), None
    user_roles = (
        db.query(Roles.name)
        .join(UserRoles, UserRoles.role_id == Roles.id)
        .filter(
            UserRoles.user_id == user_id,
            UserRoles.is_deleted.is_(False),
        )
        .all()
    )
    role_names = {role[0].lower() for role in user_roles}
    return role_names, user.role_group_id


def get_highest_role(roles: Set[str]) -> str | None:
    highest_role = None
    max_level = -1
    for role in roles:
        level = ROLE_HIERARCHY.get(role, 0)
        if level > max_level:
            max_level = level
            highest_role = role
    return highest_role


def can_manage_user(
    db: Session, current_user_id: UUID, target_user_id: UUID, active_role: Optional[str] = None
) -> bool:
    if current_user_id == target_user_id:
        return True
    current_user_roles, current_user_group_id = get_user_roles_and_group(db, current_user_id)
    target_user_roles, target_user_group_id = get_user_roles_and_group(db, target_user_id)
    if active_role:
        current_highest_role = active_role.lower()
    else:
        current_highest_role = get_highest_role(current_user_roles)
    target_highest_role = get_highest_role(target_user_roles)
    if not current_highest_role:
        return False
    if current_highest_role == "admin":
        return target_highest_role not in ("admin", "superadmin")
    if current_highest_role == "superadmin":
        return True
    if current_highest_role == "roleadmin":
        if target_highest_role in PROTECTED_ROLES:
            return False
        if current_user_group_id is None or current_user_group_id != target_user_group_id:
            return False
        return True
    return False


def can_manage_user_by_role(
    db: Session, current_user_id: UUID, target_role_name: str, active_role: Optional[str] = None
) -> bool:
    current_user_roles, _ = get_user_roles_and_group(db, current_user_id)
    if active_role:
        current_highest_role = active_role.lower()
    else:
        current_highest_role = get_highest_role(current_user_roles)
    target_role_name = target_role_name.lower()
    if not current_highest_role:
        return False
    if current_highest_role == "admin":
        return target_role_name not in ("admin", "superadmin")
    if current_highest_role == "superadmin":
        return True
    if current_highest_role == "roleadmin":
        if target_role_name in PROTECTED_ROLES:
            return False
        return True
    return False
