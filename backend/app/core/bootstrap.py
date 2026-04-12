from sqlalchemy.orm import Session

from app.core.app_nav_permissions import APP_PERMISSION_SEEDS, DEFAULT_USER_ROLE_PERMISSION_KEYS
from app.core.config import settings
from app.core.security import hash_password
from app.domains.lookup.models.permissions import Permissions
from app.domains.lookup.models.roles import Roles
from app.domains.user.models.role_permissions import RolePermissions
from app.domains.user.models.user_roles import UserRoles
from app.domains.user.models.users import Users


def seed_super_admin(db: Session) -> None:
    email = (settings.super_admin_email or "").strip()
    password = (settings.super_admin_password or "").strip()
    if not email or not password:
        return

    role = db.query(Roles).filter(Roles.name == "superadmin", Roles.is_deleted.is_(False)).first()
    if not role:
        role = Roles(
            name="superadmin",
            description="Bootstrap superadmin",
            is_protected=True,
            is_deleted=False,
        )
        db.add(role)
        db.flush()

    user = db.query(Users).filter(Users.email == email).first()
    if user:
        return

    name = settings.super_admin_name.strip() or "Super Admin"
    parts = name.split(None, 1)
    first_name = parts[0]
    last_name = parts[1] if len(parts) > 1 else "Admin"

    user = Users(
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
    db.add(UserRoles(user_id=user.id, role_id=role.id, is_deleted=False))
    db.commit()


def seed_company_owner_missing_permission_grants(db: Session) -> None:
    """Şirket sahibi rolü için yalnızca eksik (hiç kayıt yok) izin satırlarını ekler.

    Role permissions ekranında kapatılan izinler `role_permissions` satırında kalır
    (`is_deleted=True`). Eski `full_grants` mantığı her restart'ta bunları tekrar açıyordu.
    Mevcut satıra dokunulmaz; sadece (rol, izin) çifti için tabloda satır yoksa `granted` eklenir.
    Böylece yeni `Permissions` satırları ilk açılışta admin'e verilir, özelleştirme korunur.
    """
    name = (settings.default_company_owner_role_name or "admin").strip()
    if not name:
        return
    role = db.query(Roles).filter(Roles.name == name, Roles.is_deleted.is_(False)).first()
    if not role:
        return
    changed = False
    for perm in db.query(Permissions).filter(Permissions.is_deleted.is_(False)).all():
        exists = (
            db.query(RolePermissions)
            .filter(
                RolePermissions.role_id == role.id,
                RolePermissions.permission_id == perm.id,
            )
            .first()
        )
        if exists is not None:
            continue
        db.add(
            RolePermissions(
                role_id=role.id,
                permission_id=perm.id,
                is_granted=True,
                is_deleted=False,
            )
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
    """
    name = (settings.default_registered_role_name or "user").strip()
    if not name:
        return
    role = db.query(Roles).filter(Roles.name == name, Roles.is_deleted.is_(False)).first()
    if not role:
        return
    changed = False
    for key in DEFAULT_USER_ROLE_PERMISSION_KEYS:
        perm = db.query(Permissions).filter(Permissions.key == key, Permissions.is_deleted.is_(False)).first()
        if not perm:
            continue
        exists = (
            db.query(RolePermissions)
            .filter(
                RolePermissions.role_id == role.id,
                RolePermissions.permission_id == perm.id,
            )
            .first()
        )
        if exists is not None:
            continue
        db.add(
            RolePermissions(
                role_id=role.id,
                permission_id=perm.id,
                is_granted=True,
                is_deleted=False,
            )
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
            name=name,
            description="Company owner (approved company self-registration)",
            is_protected=False,
            is_deleted=False,
        )
    )
    db.commit()
