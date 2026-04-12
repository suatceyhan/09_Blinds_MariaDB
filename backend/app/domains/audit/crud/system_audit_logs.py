from typing import Any, Optional
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.domains.audit.models.system_audit_logs import SystemAuditLogs


def get_system_audit_logs_filtered(
    db: Session,
    *,
    skip: int = 0,
    limit: int = 20,
    service_name: Optional[str] = None,
    action: Optional[str] = None,
    status: Optional[str] = None,
    details: Optional[dict] = None,
    executed_by: Optional[str] = None,
    ip_address: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    time_from: Optional[str] = None,
    time_to: Optional[str] = None,
    count_total: bool = False,
) -> dict[str, Any]:
    query = db.query(SystemAuditLogs)

    if date_from:
        query = query.filter(func.date(SystemAuditLogs.timestamp) >= date_from)
    if date_to:
        query = query.filter(func.date(SystemAuditLogs.timestamp) <= date_to)
    if time_from:
        query = query.filter(func.to_char(SystemAuditLogs.timestamp, "HH24:MI") >= time_from)
    if time_to:
        query = query.filter(func.to_char(SystemAuditLogs.timestamp, "HH24:MI") <= time_to)
    if service_name:
        query = query.filter(SystemAuditLogs.service_name.ilike(f"%{service_name}%"))
    if action:
        query = query.filter(SystemAuditLogs.action.ilike(f"%{action}%"))
    if status:
        query = query.filter(SystemAuditLogs.status.ilike(f"%{status}%"))
    if details:
        query = query.filter(SystemAuditLogs.details == details)
    if executed_by:
        query = query.filter(SystemAuditLogs.executed_by.ilike(f"%{executed_by}%"))
    if ip_address:
        query = query.filter(SystemAuditLogs.ip_address.ilike(f"%{ip_address}%"))

    total = query.count() if count_total else None
    items = query.order_by(SystemAuditLogs.timestamp.desc()).offset(skip).limit(limit).all()
    return {"items": items, "total": total}


def get_system_audit_log(db: Session, log_id: UUID) -> Optional[SystemAuditLogs]:
    return db.query(SystemAuditLogs).filter(SystemAuditLogs.id == log_id).first()
