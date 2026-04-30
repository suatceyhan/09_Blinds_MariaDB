from __future__ import annotations

import sys
from pathlib import Path
from uuid import UUID

from sqlalchemy import text

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.database import SessionLocal  # noqa: E402
from app.domains.user.crud.role_permissions_admin import apply_role_permission_matrix  # noqa: E402


def parse_uuidish(s: str) -> UUID:
    s = (s or "").strip()
    if "-" in s:
        return UUID(s)
    return UUID(hex=s)


def main() -> None:
    with SessionLocal() as db:
        rid = db.execute(
            text(
                "SELECT id FROM roles WHERE name='superadmin' AND COALESCE(is_deleted,0)=0 LIMIT 1"
            )
        ).scalar()
        pid = db.execute(
            text(
                "SELECT id FROM permissions WHERE `key`='dashboard.view' AND COALESCE(is_deleted,0)=0 LIMIT 1"
            )
        ).scalar()
        uid_raw = db.execute(
            text("SELECT id FROM users WHERE LOWER(email)=LOWER('suatceyhan@gmail.com') LIMIT 1")
        ).scalar()

        print("rid", rid)
        print("pid", pid)
        print("uid_raw", uid_raw)

        apply_role_permission_matrix(
            db,
            role_id=parse_uuidish(rid),
            updates={str(pid): False},
            actor_id=parse_uuidish(uid_raw),
        )
        print("OK")


if __name__ == "__main__":
    main()

