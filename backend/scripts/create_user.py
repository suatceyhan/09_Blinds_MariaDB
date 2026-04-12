"""
Kullanici olusturur (users, roles, user_roles semasi).

backend klasorunden:
  python scripts/create_user.py --email a@b.com --password gizli123
  python scripts/create_user.py --demo
  python scripts/create_user.py --email a@b.com --password x --update

Gerekli: backend/.env icinde DATABASE_URL (+ istege bagli PASSWORD_PEPPER).
"""

from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path
from uuid import UUID

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from sqlalchemy.orm import Session  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.domains.lookup.models.roles import Roles  # noqa: E402
from app.domains.user.models.user_roles import UserRoles  # noqa: E402
from app.domains.user.models.users import Users  # noqa: E402


# DWP create_test_user.py ile ayni demo varsayilanlari (sadece --demo)
DEMO_EMAIL = "suatceyhan@hotmail.com"
DEMO_PASSWORD = "Suat.1234!"
DEMO_FIRST_NAME = "Test"
DEMO_LAST_NAME = "Staff"
DEMO_PHONE = "1234567890"


def get_or_create_role(db: Session, name: str) -> Roles:
    role = (
        db.query(Roles)
        .filter(Roles.name == name, Roles.is_deleted.is_(False))
        .first()
    )
    if role:
        return role
    role = Roles(
        name=name,
        description=f"Seed ({name})",
        is_protected=name.lower() == "superadmin",
        is_deleted=False,
    )
    db.add(role)
    db.commit()
    db.refresh(role)
    print("OK Role created:", role.name)
    return role


def assign_role_to_user(db: Session, user_id: UUID, role_id: UUID) -> None:
    existing = (
        db.query(UserRoles)
        .filter(
            UserRoles.user_id == user_id,
            UserRoles.role_id == role_id,
            UserRoles.is_deleted.is_(False),
        )
        .first()
    )
    if existing:
        print("INFO Role already assigned to user.")
        return

    stale = (
        db.query(UserRoles)
        .filter(
            UserRoles.user_id == user_id,
            UserRoles.role_id == role_id,
        )
        .first()
    )
    if stale:
        stale.is_deleted = False
        db.commit()
        db.refresh(stale)
        print("OK Role link re-activated.")
        return

    link = UserRoles(
        user_id=user_id,
        role_id=role_id,
        is_deleted=False,
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    print("OK Role assigned to user.")


def create_user(
    db: Session,
    *,
    email: str,
    password_plain: str,
    first_name: str,
    last_name: str,
    phone: str,
    default_role: Roles,
    update: bool,
) -> Users:
    email = email.strip()
    user = db.query(Users).filter(Users.email == email).first()

    if user and not update:
        print(f"INFO User already exists: {email}. Use update=True or CLI --update.")
        return user

    pwd_hash = hash_password(password_plain, settings.password_pepper)

    if user and update:
        user.password = pwd_hash
        user.is_password_set = True
        user.must_change_password = False
        user.is_deleted = False
        user.default_role = default_role.id
        db.commit()
        db.refresh(user)
        print("OK User updated:", user.email)
        return user

    user = Users(
        first_name=first_name.strip(),
        last_name=last_name.strip(),
        phone=phone.strip(),
        email=email,
        password=pwd_hash,
        is_password_set=True,
        must_change_password=False,
        is_deleted=False,
        is_first_login=True,
        default_role=default_role.id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    print("OK User created:", user.email)
    return user


def run_demo_flow() -> None:
    """DWP create_test_user.py gibi: employee + kullanici; superadmin rolu de yaratilir (DWP'de atama yoktu)."""
    db = SessionLocal()
    try:
        staff_role = get_or_create_role(db, "employee")
        _ = get_or_create_role(db, "superadmin")

        demo_exists = (
            db.query(Users).filter(Users.email == DEMO_EMAIL.strip()).first() is not None
        )
        user = create_user(
            db,
            email=DEMO_EMAIL,
            password_plain=DEMO_PASSWORD,
            first_name=DEMO_FIRST_NAME,
            last_name=DEMO_LAST_NAME,
            phone=DEMO_PHONE,
            default_role=staff_role,
            update=demo_exists,
        )
        assign_role_to_user(db, user.id, staff_role.id)

        print("Demo login:", DEMO_EMAIL, "/", DEMO_PASSWORD)
    except Exception as e:
        db.rollback()
        print("Error:", e, file=sys.stderr)
        sys.exit(1)
    finally:
        db.close()


def run_cli() -> None:
    parser = argparse.ArgumentParser(
        description="Create user for JWT login (backend/.env DATABASE_URL)."
    )
    parser.add_argument("--demo", action="store_true", help="Demo user (see DEMO_* constants)")
    parser.add_argument("--email", default=None, help="Unique email")
    parser.add_argument(
        "--password",
        default=None,
        help="Password (omit to prompt)",
    )
    parser.add_argument("--first-name", default="Admin", dest="first_name")
    parser.add_argument("--last-name", default="User", dest="last_name")
    parser.add_argument("--phone", default="0000000000")
    parser.add_argument(
        "--role",
        default="superadmin",
        help="Role name (created if missing). Default: superadmin",
    )
    parser.add_argument(
        "--update",
        action="store_true",
        help="If email exists: reset password and link role",
    )
    args = parser.parse_args()

    if args.demo:
        if args.email or args.password:
            print("Do not mix --demo with --email/--password.", file=sys.stderr)
            sys.exit(1)
        run_demo_flow()
        return

    if not args.email:
        print("Required: --email or use --demo", file=sys.stderr)
        sys.exit(1)

    password = args.password
    if not password:
        password = getpass.getpass("Password: ")
        confirm = getpass.getpass("Password (again): ")
        if password != confirm:
            print("Passwords do not match.", file=sys.stderr)
            sys.exit(1)
    if not (password or "").strip():
        print("Password must not be empty.", file=sys.stderr)
        sys.exit(1)

    db = SessionLocal()
    try:
        role = get_or_create_role(db, args.role)
        existing = db.query(Users).filter(Users.email == args.email.strip()).first()

        if existing and not args.update:
            print(
                f"Email already exists: {args.email}\n"
                "Use --update to reset password.",
                file=sys.stderr,
            )
            sys.exit(1)

        user = create_user(
            db,
            email=args.email.strip(),
            password_plain=password,
            first_name=args.first_name,
            last_name=args.last_name,
            phone=args.phone,
            default_role=role,
            update=bool(existing) and args.update,
        )
        assign_role_to_user(db, user.id, role.id)
        print("Done:", user.email, "role:", role.name)
    except SystemExit:
        raise
    except Exception as e:
        db.rollback()
        print("Error:", e, file=sys.stderr)
        sys.exit(1)
    finally:
        db.close()


def main() -> None:
    run_cli()


if __name__ == "__main__":
    main()
