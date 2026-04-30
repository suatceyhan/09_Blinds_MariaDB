from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import text

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.database import SessionLocal  # noqa: E402


def main() -> None:
    email = "suatceyhan@gmail.com"
    with SessionLocal() as db:
        u = db.execute(
            text(
                "SELECT id, email, COALESCE(is_deleted, 0) "
                "FROM users WHERE LOWER(email) = LOWER(:e) LIMIT 1"
            ),
            {"e": email},
        ).first()
        print("USER:", u)
        if not u:
            return
        uid = u[0]

        roles = db.execute(
            text(
                "SELECT ur.id, ur.user_id, ur.role_id, COALESCE(ur.is_deleted,0) ur_del, "
                "r.name, r.id rid, COALESCE(r.is_deleted,0) r_del "
                "FROM user_roles ur "
                "JOIN roles r ON r.id = ur.role_id "
                "WHERE ur.user_id = :u"
            ),
            {"u": uid},
        ).fetchall()
        print("USER_ROLES:", len(roles))
        for row in roles:
            print(" ", row)

        sup = db.execute(
            text(
                "SELECT id FROM roles "
                "WHERE name = 'superadmin' AND COALESCE(is_deleted,0)=0 LIMIT 1"
            )
        ).first()
        print("SUPERADMIN_ROLE_ID:", sup)

        dash = db.execute(
            text(
                "SELECT id FROM permissions "
                "WHERE `key` = 'dashboard.view' AND COALESCE(is_deleted,0)=0 LIMIT 1"
            )
        ).first()
        print("DASH_PERM_ID:", dash)

        if sup and dash:
            rp = db.execute(
                text(
                    "SELECT role_id, permission_id, is_granted, COALESCE(is_deleted,0) "
                    "FROM role_permissions WHERE role_id=:r AND permission_id=:p"
                ),
                {"r": sup[0], "p": dash[0]},
            ).fetchall()
            print("ROLE_PERM dashboard.view:", rp)


if __name__ == "__main__":
    main()

