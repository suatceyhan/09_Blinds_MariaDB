from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.domains.lookup.models.permissions import Permissions
from app.domains.lookup.models.roles import Roles
from app.domains.user.models.role_permissions import RolePermissions


def _uuid_candidates(u: UUID) -> tuple[str, str]:
    return (str(u), u.hex)


def _resolve_user_id_string(db: Session, user_id: UUID) -> str | None:
    """Resolve users.id to the exact stored CHAR text (dashed vs hex)."""
    d, h = _uuid_candidates(user_id)
    row = db.execute(
        text("SELECT id FROM users WHERE id=:d OR id=:h LIMIT 1"),
        {"d": d, "h": h},
    ).first()
    return row[0] if row else None


def get_permission_matrix_for_role(db: Session, role_id: UUID) -> dict[str, bool]:
    """DWP uyumu: permission_id (str) -> is_granted (yalnızca kayıtlı satırlar)."""
    # MariaDB: role_id may be stored as hex32 text; read by both candidates.
    d, h = _uuid_candidates(role_id)
    rows = db.execute(
        text(
            "SELECT permission_id, COALESCE(is_granted,0) "
            "FROM role_permissions "
            "WHERE COALESCE(is_deleted,0)=0 AND (role_id=:d OR role_id=:h)"
        ),
        {"d": d, "h": h},
    ).fetchall()
    return {str(pid): bool(granted) for (pid, granted) in rows}


def apply_role_permission_matrix(
    db: Session,
    *,
    role_id: UUID,
    updates: dict[str, bool],
    actor_id: UUID,
) -> None:
    """Matrix kaydı: her permission_id için granted True/False (DWP PUT matrisi)."""
    # Resolve role id string as stored.
    rd, rh = _uuid_candidates(role_id)
    role_row = db.execute(
        text(
            "SELECT id FROM roles WHERE COALESCE(is_deleted,0)=0 AND (id=:d OR id=:h) LIMIT 1"
        ),
        {"d": rd, "h": rh},
    ).first()
    if not role_row:
        raise ValueError("role_not_found")
    role_id_str = role_row[0]
    actor_id_str = _resolve_user_id_string(db, actor_id)

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
        row = db.execute(
            text(
                "SELECT role_id, permission_id, COALESCE(is_deleted,0) AS is_deleted "
                "FROM role_permissions WHERE role_id=:r AND permission_id=:p LIMIT 1"
            ),
            {"r": role_id_str, "p": str(pid)},
        ).first()
        if granted:
            if row:
                db.execute(
                    text(
                        "UPDATE role_permissions SET is_deleted=FALSE, is_granted=TRUE, updated_by=:a "
                        "WHERE role_id=:r AND permission_id=:p"
                    ),
                    {"a": actor_id_str, "r": role_id_str, "p": str(pid)},
                )
            else:
                db.execute(
                    text(
                        "INSERT INTO role_permissions "
                        "(role_id, permission_id, is_granted, is_deleted, created_by, updated_by) "
                        "VALUES (:r, :p, TRUE, FALSE, :a, :a)"
                    ),
                    {"r": role_id_str, "p": str(pid), "a": actor_id_str},
                )
        else:
            if row:
                db.execute(
                    text(
                        "UPDATE role_permissions SET is_deleted=TRUE, is_granted=FALSE, updated_by=:a "
                        "WHERE role_id=:r AND permission_id=:p"
                    ),
                    {"a": actor_id_str, "r": role_id_str, "p": str(pid)},
                )

    db.commit()


def list_granted_permission_ids(db: Session, role_id: UUID) -> list[UUID]:
    d, h = _uuid_candidates(role_id)
    rows = db.execute(
        text(
            "SELECT permission_id FROM role_permissions "
            "WHERE COALESCE(is_deleted,0)=0 AND COALESCE(is_granted,0)=1 "
            "AND (role_id=:d OR role_id=:h)"
        ),
        {"d": d, "h": h},
    ).fetchall()
    return [UUID(str(r[0])) for r in rows]


def sync_role_grants(
    db: Session,
    *,
    role_id: UUID,
    permission_ids: list[UUID],
    actor_id: UUID,
) -> list[UUID]:
    rd, rh = _uuid_candidates(role_id)
    role_row = db.execute(
        text(
            "SELECT id FROM roles WHERE COALESCE(is_deleted,0)=0 AND (id=:d OR id=:h) LIMIT 1"
        ),
        {"d": rd, "h": rh},
    ).first()
    if not role_row:
        raise ValueError("role_not_found")
    role_id_str = role_row[0]

    wanted = list(dict.fromkeys(permission_ids))  # dedupe, order preserved
    valid_ids = (
        db.query(Permissions.id)
        .filter(Permissions.id.in_(wanted), Permissions.is_deleted.is_(False))
        .all()
    )
    valid_set = {r[0] for r in valid_ids}
    if len(valid_set) != len(wanted):
        raise ValueError("invalid_permission")

    existing = db.execute(
        text(
            "SELECT permission_id, COALESCE(is_deleted,0) AS is_deleted, COALESCE(is_granted,0) AS is_granted "
            "FROM role_permissions WHERE role_id=:r"
        ),
        {"r": role_id_str},
    ).fetchall()
    by_perm = {UUID(str(pid)): (is_del, is_gr) for (pid, is_del, is_gr) in existing}
    wanted_set = set(wanted)

    for pid, is_del, is_gr in existing:
        pid_u = UUID(str(pid))
        if pid_u in wanted_set:
            if bool(is_del) or not bool(is_gr):
                db.execute(
                    text(
                        "UPDATE role_permissions SET is_deleted=FALSE, is_granted=TRUE, updated_by=:a "
                        "WHERE role_id=:r AND permission_id=:p"
                    ),
                    {"a": str(actor_id), "r": role_id_str, "p": str(pid_u)},
                )
        else:
            if (not bool(is_del)) or bool(is_gr):
                db.execute(
                    text(
                        "UPDATE role_permissions SET is_deleted=TRUE, is_granted=FALSE, updated_by=:a "
                        "WHERE role_id=:r AND permission_id=:p"
                    ),
                    {"a": str(actor_id), "r": role_id_str, "p": str(pid_u)},
                )

    for pid in wanted:
        if pid not in by_perm:
            db.execute(
                text(
                    "INSERT INTO role_permissions "
                    "(role_id, permission_id, is_granted, is_deleted, created_by, updated_by) "
                    "VALUES (:r, :p, TRUE, FALSE, :a, :a)"
                ),
                {"r": role_id_str, "p": str(pid), "a": str(actor_id)},
            )

    db.commit()
    return list_granted_permission_ids(db, role_id)
