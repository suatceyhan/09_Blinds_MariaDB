import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.app_nav_permissions import APP_PERMISSION_SEEDS, DEFAULT_USER_ROLE_PERMISSION_KEYS
from app.core.config import settings
from app.core.security import hash_password
from app.domains.lookup.models.permissions import Permissions
from app.domains.lookup.models.roles import Roles
from app.domains.user.models.user_roles import UserRoles
from app.domains.user.models.users import Users


def _ensure_user_role_link(db: Session, *, user_email: str, role_name: str) -> None:
    """Ensure (user, role) exists in `user_roles` (reactivate if soft-deleted).

    Uses raw SQL and resolves ids from DB to avoid hex/dashed UUID representation mismatches.
    """
    u = db.execute(
        text("SELECT id FROM users WHERE LOWER(email) = LOWER(:e) LIMIT 1"),
        {"e": (user_email or "").strip()},
    ).first()
    r = db.execute(
        text(
            "SELECT id FROM roles WHERE name = :n AND COALESCE(is_deleted, FALSE) = FALSE LIMIT 1"
        ),
        {"n": role_name},
    ).first()
    if u is None or r is None:
        return
    uid = u[0]
    rid = r[0]
    existing = db.execute(
        text(
            "SELECT id, COALESCE(is_deleted, FALSE) AS is_deleted "
            "FROM user_roles WHERE user_id = :u AND role_id = :r LIMIT 1"
        ),
        {"u": uid, "r": rid},
    ).first()
    if existing is not None:
        if bool(existing[1]):
            db.execute(
                text("UPDATE user_roles SET is_deleted = FALSE WHERE id = :id"),
                {"id": existing[0]},
            )
            db.commit()
        return
    db.execute(
        text(
            "INSERT INTO user_roles (id, user_id, role_id, is_deleted) "
            "VALUES (UUID(), :u, :r, FALSE)"
        ),
        {"u": uid, "r": rid},
    )
    db.commit()


def _ensure_demo_company_for_user(db: Session, *, user_email: str) -> None:
    """Ensure the user has an active company (dev convenience for tenant-scoped endpoints)."""
    u = db.execute(
        text("SELECT id, company_id FROM users WHERE LOWER(email)=LOWER(:e) LIMIT 1"),
        {"e": (user_email or "").strip()},
    ).first()
    if not u:
        return
    uid, company_id = u[0], u[1]
    if company_id:
        return
    has_mid = db.execute(
        text(
            "SELECT 1 FROM user_company_memberships "
            "WHERE COALESCE(is_deleted,0)=0 AND user_id=:u LIMIT 1"
        ),
        {"u": uid},
    ).first()
    if has_mid:
        return

    co_id = db.execute(
        text(
            "SELECT id FROM companies WHERE name=:name AND COALESCE(is_deleted,FALSE)=FALSE LIMIT 1"
        ),
        {"name": "Demo Company"},
    ).scalar()
    if not co_id:
        db.execute(
            text(
                "INSERT INTO companies (id, name, phone, website, email, is_deleted) "
                "VALUES (UUID(), :name, NULL, NULL, :email, FALSE)"
            ),
            {"name": "Demo Company", "email": (user_email or "").strip()},
        )
        db.commit()
        co_id = db.execute(
            text(
                "SELECT id FROM companies WHERE name=:name AND COALESCE(is_deleted,FALSE)=FALSE "
                "ORDER BY created_at DESC LIMIT 1"
            ),
            {"name": "Demo Company"},
        ).scalar()
    if not co_id:
        return
    db.execute(
        text(
            "INSERT INTO user_company_memberships (id, user_id, company_id, is_deleted) "
            "VALUES (UUID(), :u, :c, FALSE)"
        ),
        {"u": uid, "c": co_id},
    )
    db.execute(text("UPDATE users SET company_id=:c WHERE id=:u"), {"u": uid, "c": co_id})
    db.commit()


def seed_super_admin(db: Session) -> None:
    email = (settings.super_admin_email or "").strip()
    password = (settings.super_admin_password or "").strip()
    if not email or not password:
        return

    role = db.query(Roles).filter(Roles.name == "superadmin", Roles.is_deleted.is_(False)).first()
    role_created = False
    if not role:
        # MariaDB fills DEFAULT (UUID()) server-side; ORM does not reliably refresh PK after flush,
        # so FK inserts would reference a client-side id that does not exist in `roles`.
        role = Roles(
            id=uuid.uuid4(),
            name="superadmin",
            description="Bootstrap superadmin",
            is_protected=True,
            is_deleted=False,
        )
        db.add(role)
        db.flush()
        role_created = True

    user = db.query(Users).filter(Users.email == email).first()
    if user:
        # Ensure a freshly inserted superadmin role is committed before later seeds (same session).
        if role_created:
            db.commit()
        # If the user exists already (e.g. DB imported), still ensure superadmin role assignment.
        _ensure_user_role_link(db, user_email=email, role_name="superadmin")
        _ensure_demo_company_for_user(db, user_email=email)
        return

    name = settings.super_admin_name.strip() or "Super Admin"
    parts = name.split(None, 1)
    first_name = parts[0]
    last_name = parts[1] if len(parts) > 1 else "Admin"

    user = Users(
        id=uuid.uuid4(),
        first_name=first_name,
        last_name=last_name,
        phone="0000000000",
        email=email,
        password=hash_password(password, settings.password_pepper),
        is_password_set=True,
        must_change_password=False,
        is_deleted=False,
        default_role=role.id,
    )
    db.add(user)
    db.flush()
    db.commit()
    _ensure_user_role_link(db, user_email=email, role_name="superadmin")
    _ensure_demo_company_for_user(db, user_email=email)


def seed_company_owner_missing_permission_grants(_db: Session) -> None:
    """Reserved for compatibility with startup order; intentionally does not grant permissions.

    Fresh installs use zero grants for non-superadmin roles (`admin`, `user`, …).
    Superadmin receives all permissions via `seed_superadmin_missing_permission_grants`.
    Assign grants in Settings → Role permissions after onboarding.
    """


def seed_superadmin_missing_permission_grants(db: Session) -> None:
    """Superadmin role should have all permissions (missing rows auto-added).

    The UI role matrix reads from `role_permissions`. If a permission row exists in `permissions`
    but the (role, permission) pair is missing in `role_permissions`, it appears as OFF.
    We only insert missing pairs and do not modify existing rows (including `is_deleted=True` customizations).

    Uses raw SQL with ids read back from the DB so ``role_id`` / ``permission_id`` strings match
    the exact stored representation (legacy hex vs dashed UUID text in ``CHAR(36)``).
    """
    row = db.execute(
        text(
            "SELECT id FROM roles WHERE name = :name AND COALESCE(is_deleted, FALSE) = FALSE LIMIT 1"
        ),
        {"name": "superadmin"},
    ).first()
    if row is None:
        return
    role_id_str = row[0]

    perm_rows = db.execute(
        text("SELECT id FROM permissions WHERE COALESCE(is_deleted, FALSE) = FALSE"),
    ).fetchall()

    changed = False
    for (perm_id_str,) in perm_rows:
        exists = db.execute(
            text(
                "SELECT 1 FROM role_permissions WHERE role_id = :r AND permission_id = :p LIMIT 1"
            ),
            {"r": role_id_str, "p": perm_id_str},
        ).first()
        if exists is not None:
            continue
        db.execute(
            text(
                "INSERT INTO role_permissions (role_id, permission_id, is_granted, is_deleted) "
                "VALUES (:r, :p, TRUE, FALSE)"
            ),
            {"r": role_id_str, "p": perm_id_str},
        )
        changed = True
    if changed:
        db.commit()


def seed_starter_permissions(db: Session) -> None:
    """Menü / DWP tarzı matris ile uyumlu .view / .edit izinleri."""
    for key, name, module, sort_ix in APP_PERMISSION_SEEDS:
        exists = db.query(Permissions).filter(Permissions.key == key).first()
        if exists:
            continue
        db.add(
            Permissions(
                id=uuid.uuid4(),
                key=key,
                name=name,
                parent_key=None,
                target_type="module",
                target_id=module,
                action="access",
                module_name=module,
                sort_index=sort_ix,
                is_deleted=False,
            )
        )
    db.commit()


def seed_default_user_role_permission_grants(db: Session) -> None:
    """`user` rolü için DEFAULT_USER_ROLE_PERMISSION_KEYS içinde eksik satır varsa ekler.

    Matriste kapatılan izinler `role_permissions` üzerinde kalır (`is_deleted=True`). Eski mantık
    her restart'ta bunları yeniden açıyordu; mevcut satıra dokunulmaz (admin seed ile aynı ilke).

    Raw SQL id strings — same rationale as ``seed_superadmin_missing_permission_grants``.
    """
    name = (settings.default_registered_role_name or "user").strip()
    if not name:
        return
    row = db.execute(
        text(
            "SELECT id FROM roles WHERE name = :name AND COALESCE(is_deleted, FALSE) = FALSE LIMIT 1"
        ),
        {"name": name},
    ).first()
    if row is None:
        return
    role_id_str = row[0]

    changed = False
    for key in DEFAULT_USER_ROLE_PERMISSION_KEYS:
        prow = db.execute(
            text(
                "SELECT id FROM permissions WHERE `key` = :k AND COALESCE(is_deleted, FALSE) = FALSE LIMIT 1"
            ),
            {"k": key},
        ).first()
        if prow is None:
            continue
        perm_id_str = prow[0]
        exists = db.execute(
            text(
                "SELECT 1 FROM role_permissions WHERE role_id = :r AND permission_id = :p LIMIT 1"
            ),
            {"r": role_id_str, "p": perm_id_str},
        ).first()
        if exists is not None:
            continue
        db.execute(
            text(
                "INSERT INTO role_permissions (role_id, permission_id, is_granted, is_deleted) "
                "VALUES (:r, :p, TRUE, FALSE)"
            ),
            {"r": role_id_str, "p": perm_id_str},
        )
        changed = True
    if changed:
        db.commit()


def seed_default_registration_role(db: Session) -> None:
    """Acik kayit icin varsayilan rol (or. 'user'); yoksa ekler."""
    name = (settings.default_registered_role_name or "user").strip()
    if not name:
        return
    existing = db.query(Roles).filter(Roles.name == name, Roles.is_deleted.is_(False)).first()
    if existing:
        return
    db.add(
        Roles(
            id=uuid.uuid4(),
            name=name,
            description="Self-service registered user",
            is_protected=False,
            is_deleted=False,
        )
    )
    db.commit()


def seed_default_company_owner_role(db: Session) -> None:
    """Pending şirket onayı sonrası sahip kullanıcıya atanacak rol (varsayılan admin)."""
    name = (settings.default_company_owner_role_name or "admin").strip()
    if not name:
        return
    existing = db.query(Roles).filter(Roles.name == name, Roles.is_deleted.is_(False)).first()
    if existing:
        return
    db.add(
        Roles(
            id=uuid.uuid4(),
            name=name,
            description="Company owner (approved company self-registration)",
            is_protected=False,
            is_deleted=False,
        )
    )
    db.commit()
