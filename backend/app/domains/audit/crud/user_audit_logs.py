from typing import Any, Optional
from uuid import UUID

import sqlalchemy
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.domains.audit.models.user_audit_logs import UserAuditLogs


def get_user_audit_logs_filtered(
    db: Session,
    *,
    skip: int = 0,
    limit: int = 20,
    executed_by: Optional[UUID] = None,
    action: Optional[str] = None,
    table_name: Optional[str] = None,
    table_id: Optional[UUID] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    time_from: Optional[str] = None,
    time_to: Optional[str] = None,
    before_data: Optional[str] = None,
    after_data: Optional[str] = None,
    count_total: bool = False,
) -> dict[str, Any]:
    query = db.query(UserAuditLogs)

    if date_from:
        query = query.filter(func.date(UserAuditLogs.timestamp) >= date_from)
    if date_to:
        query = query.filter(func.date(UserAuditLogs.timestamp) <= date_to)
    if time_from:
        query = query.filter(func.to_char(UserAuditLogs.timestamp, "HH24:MI") >= time_from)
    if time_to:
        query = query.filter(func.to_char(UserAuditLogs.timestamp, "HH24:MI") <= time_to)
    if executed_by is not None:
        query = query.filter(UserAuditLogs.executed_by == executed_by)
    if action:
        query = query.filter(UserAuditLogs.action.ilike(f"%{action}%"))
    if table_name:
        query = query.filter(UserAuditLogs.table_name.ilike(f"%{table_name}%"))
    if table_id is not None:
        query = query.filter(UserAuditLogs.table_id == table_id)
    if before_data:
        query = query.filter(
            sqlalchemy.cast(UserAuditLogs.before_data, sqlalchemy.String).ilike(f"%{before_data}%")
        )
    if after_data:
        query = query.filter(
            sqlalchemy.cast(UserAuditLogs.after_data, sqlalchemy.String).ilike(f"%{after_data}%")
        )
    if ip_address:
        query = query.filter(UserAuditLogs.ip_address.ilike(f"%{ip_address}%"))
    if user_agent:
        query = query.filter(UserAuditLogs.user_agent.ilike(f"%{user_agent}%"))

    total = query.count() if count_total else None
    items = query.order_by(UserAuditLogs.timestamp.desc()).offset(skip).limit(limit).all()
    return {"items": items, "total": total}


def get_user_audit_log(db: Session, log_id: UUID) -> Optional[UserAuditLogs]:
    return db.query(UserAuditLogs).filter(UserAuditLogs.id == log_id).first()
