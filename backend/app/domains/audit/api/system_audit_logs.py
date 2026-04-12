import json
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.dependencies.auth import require_superadmin
from app.domains.audit.crud import system_audit_logs as crud
from app.domains.audit.schemas.system_audit_logs import SystemAuditLogOut
from app.domains.user.models.users import Users

router = APIRouter(prefix="/audit/system-logs", tags=["system-audit-logs"])


@router.get("", response_model=dict[str, Any])
def read_system_audit_logs(
    skip: int = Query(0),
    limit: int = Query(20),
    service_name: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    details: Optional[str] = Query(None),
    executed_by: Optional[str] = Query(None),
    ip_address: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    time_from: Optional[str] = Query(None),
    time_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: Users = Depends(require_superadmin),
):
    try:
        details_dict = json.loads(details) if details else None
    except json.JSONDecodeError:
        details_dict = None
    result = crud.get_system_audit_logs_filtered(
        db=db,
        skip=skip,
        limit=limit,
        service_name=service_name,
        action=action,
        status=status,
        details=details_dict,
        executed_by=executed_by,
        ip_address=ip_address,
        date_from=date_from,
        date_to=date_to,
        time_from=time_from,
        time_to=time_to,
        count_total=True,
    )
    items = [SystemAuditLogOut.model_validate(x) for x in result["items"]]
    return {"items": items, "total": result["total"]}


@router.get("/{log_id}", response_model=SystemAuditLogOut)
def read_system_audit_log(
    log_id: UUID,
    db: Session = Depends(get_db),
    _: Users = Depends(require_superadmin),
):
    row = crud.get_system_audit_log(db, log_id=log_id)
    if row is None:
        raise HTTPException(status_code=404, detail="System audit log not found")
    return row
