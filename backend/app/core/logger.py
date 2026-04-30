import logging
import json
from typing import Any, Dict, Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def log_user_action(
    db: Session,
    executed_by: Optional[UUID] = None,
    action: Optional[str] = None,
    table_name: Optional[str] = None,
    table_id: Optional[UUID] = None,
    before_data: Any = None,
    after_data: Any = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> None:
    try:
        # MariaDB: `users.id` may be stored as hex32 or dashed36; ORM binding can violate FK
        # on `user_audit_logs.executed_by`. Resolve the exact stored id and insert via raw SQL.
        raw_exec: Optional[str] = None
        if executed_by is not None:
            dashed = str(executed_by)
            hex32 = executed_by.hex
            for candidate in (dashed, hex32):
                row = db.execute(
                    text("SELECT id FROM users WHERE id = :x LIMIT 1"),
                    {"x": candidate},
                ).first()
                if row:
                    raw_exec = row[0]
                    break

        before_json = json.dumps(before_data) if before_data is not None else None
        after_json = json.dumps(after_data) if after_data is not None else None
        table_id_str = str(table_id) if table_id is not None else None

        db.execute(
            text(
                "INSERT INTO user_audit_logs "
                "(id, executed_by, action, table_name, table_id, before_data, after_data, ip_address, user_agent) "
                "VALUES (UUID(), :exec, :action, :table, :tid, :before, :after, :ip, :ua)"
            ),
            {
                "exec": raw_exec,
                "action": action or "UNKNOWN",
                "table": table_name or "UNKNOWN",
                "tid": table_id_str,
                "before": before_json,
                "after": after_json,
                "ip": ip_address,
                "ua": user_agent,
            },
        )
        db.commit()
    except SQLAlchemyError as e:
        logger.warning("user_audit_logs yazılamadı: %s", e)
        try:
            db.rollback()
        except Exception:
            pass
    except Exception as e:
        logger.warning("user_audit_logs beklenmeyen hata: %s", e)


def log_system_event(
    db: Session,
    service_name: str,
    action: str,
    status: str,
    details: Optional[Dict[str, Any]] = None,
    executed_by: Optional[str] = None,
    ip_address: Optional[str] = None,
) -> None:
    try:
        from app.domains.audit.models.system_audit_logs import SystemAuditLogs

        row = SystemAuditLogs(
            service_name=service_name,
            action=action,
            status=status,
            details=details,
            executed_by=executed_by or "anonymous",
            ip_address=ip_address,
        )
        db.add(row)
        db.commit()
    except SQLAlchemyError as e:
        logger.warning("system_audit_logs yazılamadı: %s", e)
        try:
            db.rollback()
        except Exception:
            pass
    except Exception as e:
        logger.warning("system_audit_logs beklenmeyen hata: %s", e)
