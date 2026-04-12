from uuid import UUID

from sqlalchemy.orm import Session

from app.domains.lookup.models.permissions import Permissions
from app.domains.lookup.models.roles import Roles
from app.domains.user.models.role_permissions import RolePermissions
from app.domains.user.models.user_permissions import UserPermissions


def get_user_role_permission_matrix_rows(
    db: Session, *, user_id: UUID, role_id: UUID
) -> list[dict]:
    """DWP user-role-matrix: her izin için role / kullanıcı override bilgisi."""
    role = db.query(Roles).filter(Roles.id == role_id, Roles.is_deleted.is_(False)).first()
    if not role:
        return []

    is_super_role = role.name.lower() == "superadmin"

    role_rows = (
        db.query(RolePermissions)
        .filter(
            RolePermissions.role_id == role_id,
            RolePermissions.is_deleted.is_(False),
        )
        .all()
    )
    role_map = {str(r.permission_id): r for r in role_rows}

    user_rows = (
        db.query(UserPermissions)
        .filter(
            UserPermissions.user_id == user_id,
            UserPermissions.role_id == role_id,
            UserPermissions.is_deleted.is_(False),
        )
        .all()
    )
    user_map = {str(r.permission_id): r for r in user_rows}

    perms = (
        db.query(Permissions)
        .filter(Permissions.is_deleted.is_(False))
        .order_by(Permissions.sort_index, Permissions.key)
        .all()
    )

    out: list[dict] = []
    for perm in perms:
        pid = str(perm.id)
        if is_super_role:
            role_granted = True
        else:
            rp = role_map.get(pid)
            role_granted = bool(rp and rp.is_granted)

        up = user_map.get(pid)
        override = up is not None
        if override:
            final = bool(up.is_granted)
        else:
            final = role_granted

        out.append(
            {
                "permission_id": pid,
                "permission_key": perm.key,
                "permission_name": perm.name,
                "category": perm.module_name or "General",
                "parent_category": perm.parent_key,
                "role_is_granted": role_granted,
                "user_is_granted": final,
                "user_override": override,
            }
        )
    return out


def bulk_update_user_permissions_for_role(
    db: Session,
    *,
    user_id: UUID,
    role_id: UUID,
    updates: dict[str, bool],
    acting_user_id: UUID | None,
) -> int:
    """Override satırları: gönderilen permission_id -> is_granted; gönderilmeyen aktif override silinir."""
    count = 0
    for perm_id_str, is_granted in updates.items():
        try:
            puuid = UUID(str(perm_id_str))
        except ValueError:
            continue
        if (
            not db.query(Permissions.id)
            .filter(Permissions.id == puuid, Permissions.is_deleted.is_(False))
            .first()
        ):
            continue

        row = (
            db.query(UserPermissions)
            .filter(
                UserPermissions.user_id == user_id,
                UserPermissions.role_id == role_id,
                UserPermissions.permission_id == puuid,
            )
            .first()
        )
        if row:
            row.is_granted = bool(is_granted)
            row.is_deleted = False
            row.updated_by = acting_user_id
        else:
            db.add(
                UserPermissions(
                    user_id=user_id,
                    permission_id=puuid,
                    role_id=role_id,
                    is_granted=bool(is_granted),
                    is_deleted=False,
                    created_by=acting_user_id,
                    updated_by=acting_user_id,
                )
            )
        count += 1

    active = (
        db.query(UserPermissions)
        .filter(
            UserPermissions.user_id == user_id,
            UserPermissions.role_id == role_id,
            UserPermissions.is_deleted.is_(False),
        )
        .all()
    )
    for row in active:
        if str(row.permission_id) not in updates:
            row.is_deleted = True
            row.updated_by = acting_user_id

    db.commit()
    return count
