import json
from typing import Any, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.dependencies.auth import require_superadmin
from app.domains.audit.crud import user_audit_logs as crud
from app.domains.audit.schemas.user_audit_logs import UserAuditLogOut
from app.domains.user.models.users import Users

router = APIRouter(prefix="/audit/user-logs", tags=["user-audit-logs"])


@router.get("", response_model=dict[str, Any])
def read_user_audit_logs(
    skip: int = Query(0),
    limit: int = Query(20),
    executed_by: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    table_name: Optional[str] = Query(None),
    ip_address: Optional[str] = Query(None),
    user_agent: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    time_from: Optional[str] = Query(None),
    time_to: Optional[str] = Query(None),
    before_data: Optional[str] = Query(None),
    after_data: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: Users = Depends(require_superadmin),
):
    exec_uuid: Optional[UUID] = None
    if executed_by:
        try:
            exec_uuid = UUID(executed_by)
        except ValueError:
            exec_uuid = None

    result = crud.get_user_audit_logs_filtered(
        db=db,
        skip=skip,
        limit=limit,
        executed_by=exec_uuid,
        action=action,
        table_name=table_name,
        ip_address=ip_address,
        user_agent=user_agent,
        date_from=date_from,
        date_to=date_to,
        time_from=time_from,
        time_to=time_to,
        before_data=before_data,
        after_data=after_data,
        count_total=True,
    )
    items = [UserAuditLogOut.model_validate(x) for x in result["items"]]
    return {"items": items, "total": result["total"]}


@router.get("/{log_id}", response_model=UserAuditLogOut)
def read_user_audit_log(
    log_id: UUID,
    db: Session = Depends(get_db),
    _: Users = Depends(require_superadmin),
):
    row = crud.get_user_audit_log(db, log_id=log_id)
    if not row:
        raise HTTPException(status_code=404, detail="User audit log not found")
    return row
