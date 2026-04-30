from __future__ import annotations

import sys
import traceback
from pathlib import Path
from uuid import UUID

from sqlalchemy import text

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.config import settings  # noqa: E402
from app.core.database import SessionLocal  # noqa: E402
from app.core.logger import log_system_event, log_user_action  # noqa: E402
from app.domains.user.crud import rbac_assignments as crud  # noqa: E402


def parse_uuidish(s: str) -> UUID:
    s = (s or "").strip()
    if "-" in s:
        return UUID(s)
    return UUID(hex=s)


def main() -> None:
    with SessionLocal() as db:
        try:
            uid_raw = db.execute(
                text("SELECT id FROM users WHERE LOWER(email)=LOWER(:e) LIMIT 1"),
                {"e": settings.super_admin_email},
            ).scalar()
            rid_raw = db.execute(
                text("SELECT id FROM roles WHERE name='admin' AND COALESCE(is_deleted,0)=0 LIMIT 1")
            ).scalar()
            print("uid_raw", uid_raw)
            print("rid_raw", rid_raw)
            uid = parse_uuidish(uid_raw)
            rid = parse_uuidish(rid_raw)

            created, reactivated, before = crud.assign_role(
                db, user_id=uid, role_id=rid, actor_id=uid
            )
            print("created", created, "reactivated", reactivated)

            log_user_action(
                db=db,
                executed_by=uid,
                action="update" if reactivated else "create",
                table_name="user_roles",
                table_id=created["id"],
                before_data=before,
                after_data=created,
                ip_address="127.0.0.1",
                user_agent="x",
            )
            log_system_event(
                db=db,
                service_name="user",
                action="assign_role",
                status="success",
                details={"user_role_id": str(created["id"])},
                executed_by=settings.super_admin_email,
                ip_address="127.0.0.1",
            )
            print("OK")
        except Exception:
            traceback.print_exc()


if __name__ == "__main__":
    main()

