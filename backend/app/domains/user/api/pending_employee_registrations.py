from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.logger import log_user_action, log_system_event
from app.dependencies.auth import require_superadmin
from app.domains.user.crud import pending_employee_self_registrations as crud
from app.domains.user.models.users import Users
from app.domains.user.schemas.pending_employee_self_registrations import (
    PendingEmployeeDenyBody,
    PendingEmployeeSelfRegistrationOut,
)
from app.domains.user.services.pending_registration_service import PendingRegistrationService

router = APIRouter(prefix="/pending-employee-registrations", tags=["Pending employee registrations"])


@router.get("", response_model=list[PendingEmployeeSelfRegistrationOut])
def list_pending(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    _: Users = Depends(require_superadmin),
):
    rows = crud.list_pending(db, skip=skip, limit=limit, include_deleted=False)
    return rows


@router.get("/{registration_id}", response_model=PendingEmployeeSelfRegistrationOut)
def get_pending(
    registration_id: UUID,
    db: Session = Depends(get_db),
    _: Users = Depends(require_superadmin),
):
    row = crud.get_pending(db, registration_id)
    if not row or row.is_deleted:
        raise HTTPException(status_code=404, detail="Application not found.")
    return row


@router.post("/{registration_id}/approve")
def approve_pending(
    registration_id: UUID,
    db: Session = Depends(get_db),
    admin: Users = Depends(require_superadmin),
):
    user = PendingRegistrationService.approve(db, registration_id, admin.id)
    log_user_action(
        db=db,
        executed_by=admin.id,
        action="approve_pending_employee",
        table_name="pending_employee_self_registrations",
        table_id=registration_id,
        before_data=None,
        after_data={"user_id": str(user.id), "email": user.email},
    )
    return {
        "detail": "Application approved; user created.",
        "user_id": str(user.id),
        "email": user.email,
    }


@router.post("/{registration_id}/deny")
def deny_pending(
    registration_id: UUID,
    body: PendingEmployeeDenyBody | None = None,
    db: Session = Depends(get_db),
    admin: Users = Depends(require_superadmin),
):
    _ = body
    PendingRegistrationService.deny(db, registration_id, admin.id)
    log_user_action(
        db=db,
        executed_by=admin.id,
        action="deny_pending_employee",
        table_name="pending_employee_self_registrations",
        table_id=registration_id,
        before_data=None,
        after_data=None,
    )
    log_system_event(
        db=db,
        service_name="registration",
        action="deny_pending_employee_api",
        status="success",
        details={"registration_id": str(registration_id)},
        executed_by=admin.email,
    )
    return {"detail": "Application denied."}
