# PolicyEngine / RBAC — Users ve lookup modelleriyle kullanılır

from __future__ import annotations

import logging
from typing import List, Optional, Set
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func
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


def user_has_superadmin_assignment(db: Session, user_id: UUID) -> bool:
    """Kullanıcıya atanmış (silinmemiş) superadmin rolü var mı."""
    row = (
        db.query(UserRoles)
        .join(Roles, UserRoles.role_id == Roles.id)
        .filter(
            UserRoles.user_id == user_id,
            UserRoles.is_deleted.is_(False),
            Roles.is_deleted.is_(False),
            Roles.name.ilike("superadmin"),
        )
        .first()
    )
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
    super_admin_role = (
        db.query(UserRoles)
        .join(Roles, UserRoles.role_id == Roles.id)
        .filter(
            UserRoles.user_id == user_id,
            UserRoles.is_deleted.is_(False),
            Roles.name.ilike("%superadmin%"),
        )
        .first()
    )
    return super_admin_role is not None


def _check_active_role_permission(
    db: Session, user_id: UUID, permission_key: str, active_role: str
) -> bool:
    role_obj = resolve_role_by_active_name(db, active_role)
    if not role_obj:
        return False
    role_id = role_obj.id
    user_perm = (
        db.query(UserPermissions)
        .join(Permissions, UserPermissions.permission_id == Permissions.id)
        .filter(
            UserPermissions.user_id == user_id,
            UserPermissions.role_id == role_id,
            UserPermissions.is_deleted.is_(False),
            Permissions.key == permission_key,
        )
        .first()
    )
    if user_perm is not None:
        return bool(user_perm.is_granted)
    role_perm = (
        db.query(RolePermissions)
        .join(Permissions, RolePermissions.permission_id == Permissions.id)
        .filter(
            RolePermissions.role_id == role_id,
            RolePermissions.is_deleted.is_(False),
            RolePermissions.is_granted.is_(True),
            Permissions.key == permission_key,
        )
        .first()
    )
    return role_perm is not None


def _check_legacy_permissions(db: Session, user_id: UUID, permission_key: str) -> bool:
    super_admin_role = (
        db.query(UserRoles)
        .join(Roles, UserRoles.role_id == Roles.id)
        .filter(
            UserRoles.user_id == user_id,
            UserRoles.is_deleted.is_(False),
            Roles.name == "superAdmin",
        )
        .first()
    )
    if super_admin_role:
        return True
    user_role_ids = {
        r_id
        for (r_id,) in db.query(UserRoles.role_id)
        .filter(UserRoles.user_id == user_id, UserRoles.is_deleted.is_(False))
        .all()
    }
    direct_perm_ids = {
        p_id
        for (p_id,) in db.query(UserPermissions.permission_id)
        .filter(
            UserPermissions.user_id == user_id,
            UserPermissions.is_deleted.is_(False),
            UserPermissions.is_granted.is_(True),
        )
        .all()
    }
    role_perm_ids: set = set()
    if user_role_ids:
        role_perm_ids = {
            p_id
            for (p_id,) in db.query(RolePermissions.permission_id)
            .filter(
                RolePermissions.role_id.in_(user_role_ids),
                RolePermissions.is_deleted.is_(False),
                RolePermissions.is_granted.is_(True),
            )
            .all()
        }
    all_perm_ids = direct_perm_ids.union(role_perm_ids)
    if not all_perm_ids:
        return False
    user_perm_keys = {
        key for (key,) in db.query(Permissions.key).filter(Permissions.id.in_(all_perm_ids)).all()
    }
    if permission_key in user_perm_keys:
        return True
    all_permissions_hierarchy = (
        db.query(Permissions.key, Permissions.parent_key).filter(Permissions.is_deleted.is_(False)).all()
    )
    hierarchy_map = {key: parent_key for key, parent_key in all_permissions_hierarchy if key}
    current_key = hierarchy_map.get(permission_key)
    while current_key:
        if current_key in user_perm_keys:
            return True
        current_key = hierarchy_map.get(current_key)
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
    role_ids = (
        db.query(UserRoles.role_id)
        .filter(UserRoles.user_id == user_id, UserRoles.is_deleted.is_(False))
        .subquery()
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
