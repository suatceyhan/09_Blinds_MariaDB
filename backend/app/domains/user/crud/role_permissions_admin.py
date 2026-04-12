from uuid import UUID

from sqlalchemy.orm import Session

from app.domains.lookup.models.permissions import Permissions
from app.domains.lookup.models.roles import Roles
from app.domains.user.models.role_permissions import RolePermissions


def get_permission_matrix_for_role(db: Session, role_id: UUID) -> dict[str, bool]:
    """DWP uyumu: permission_id (str) -> is_granted (yalnızca kayıtlı satırlar)."""
    rows = (
        db.query(RolePermissions)
        .filter(
            RolePermissions.role_id == role_id,
            RolePermissions.is_deleted.is_(False),
        )
        .all()
    )
    return {str(r.permission_id): bool(r.is_granted) for r in rows}


def apply_role_permission_matrix(
    db: Session,
    *,
    role_id: UUID,
    updates: dict[str, bool],
    actor_id: UUID,
) -> None:
    """Matrix kaydı: her permission_id için granted True/False (DWP PUT matrisi)."""
    role = db.query(Roles).filter(Roles.id == role_id, Roles.is_deleted.is_(False)).first()
    if not role:
        raise ValueError("role_not_found")

    for perm_id_str, granted in updates.items():
        try:
            pid = UUID(str(perm_id_str))
        except ValueError:
            continue
        if (
            not db.query(Permissions.id)
            .filter(Permissions.id == pid, Permissions.is_deleted.is_(False))
            .first()
        ):
            continue
        row = (
            db.query(RolePermissions)
            .filter(
                RolePermissions.role_id == role_id,
                RolePermissions.permission_id == pid,
            )
            .first()
        )
        if granted:
            if row:
                row.is_deleted = False
                row.is_granted = True
                row.updated_by = actor_id
            else:
                db.add(
                    RolePermissions(
                        role_id=role_id,
                        permission_id=pid,
                        is_granted=True,
                        is_deleted=False,
                        created_by=actor_id,
                        updated_by=actor_id,
                    )
                )
        else:
            if row and (not row.is_deleted or row.is_granted):
                row.is_deleted = True
                row.is_granted = False
                row.updated_by = actor_id

    db.commit()


def list_granted_permission_ids(db: Session, role_id: UUID) -> list[UUID]:
    rows = (
        db.query(RolePermissions.permission_id)
        .filter(
            RolePermissions.role_id == role_id,
            RolePermissions.is_deleted.is_(False),
            RolePermissions.is_granted.is_(True),
        )
        .all()
    )
    return [r[0] for r in rows]


def sync_role_grants(
    db: Session,
    *,
    role_id: UUID,
    permission_ids: list[UUID],
    actor_id: UUID,
) -> list[UUID]:
    role = db.query(Roles).filter(Roles.id == role_id, Roles.is_deleted.is_(False)).first()
    if not role:
        raise ValueError("role_not_found")

    wanted = list(dict.fromkeys(permission_ids))  # dedupe, order preserved
    valid_ids = (
        db.query(Permissions.id)
        .filter(Permissions.id.in_(wanted), Permissions.is_deleted.is_(False))
        .all()
    )
    valid_set = {r[0] for r in valid_ids}
    if len(valid_set) != len(wanted):
        raise ValueError("invalid_permission")

    existing = db.query(RolePermissions).filter(RolePermissions.role_id == role_id).all()
    by_perm = {row.permission_id: row for row in existing}
    wanted_set = set(wanted)

    for row in existing:
        if row.permission_id in wanted_set:
            if row.is_deleted or not row.is_granted:
                row.is_deleted = False
                row.is_granted = True
                row.updated_by = actor_id
        else:
            if not row.is_deleted or row.is_granted:
                row.is_deleted = True
                row.is_granted = False
                row.updated_by = actor_id

    for pid in wanted:
        if pid not in by_perm:
            db.add(
                RolePermissions(
                    role_id=role_id,
                    permission_id=pid,
                    is_granted=True,
                    is_deleted=False,
                    created_by=actor_id,
                    updated_by=actor_id,
                )
            )

    db.commit()
    return list_granted_permission_ids(db, role_id)
