import logging
from typing import Any, Dict, Optional
from uuid import UUID

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
        from app.domains.audit.models.user_audit_logs import UserAuditLogs

        row = UserAuditLogs(
            executed_by=executed_by,
            action=action or "UNKNOWN",
            table_name=table_name or "UNKNOWN",
            table_id=table_id,
            before_data=before_data,
            after_data=after_data,
            ip_address=ip_address,
            user_agent=user_agent,
        )
        db.add(row)
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
