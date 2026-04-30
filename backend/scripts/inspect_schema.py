from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import text

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.database import SessionLocal  # noqa: E402


def main() -> None:
    with SessionLocal() as db:
        revoked = db.execute(
            text(
                "SELECT COLUMN_NAME, COLUMN_TYPE "
                "FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() "
                "AND TABLE_NAME = 'revoked_tokens' "
                "AND COLUMN_NAME IN ('id','token','user_id')"
            )
        ).fetchall()
        print("revoked_tokens:", revoked)

        audit = db.execute(
            text(
                "SELECT COLUMN_NAME, COLUMN_TYPE "
                "FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() "
                "AND TABLE_NAME = 'user_audit_logs' "
                "AND COLUMN_NAME IN ('executed_by','action','table_name','before_data','after_data')"
            )
        ).fetchall()
        print("user_audit_logs:", audit)


if __name__ == "__main__":
    main()

