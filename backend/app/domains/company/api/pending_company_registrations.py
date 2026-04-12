from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.logger import log_system_event, log_user_action
from app.dependencies.auth import require_superadmin
from app.domains.company.crud import pending_company_self_registrations as crud
from app.domains.company.schemas.pending_company_self_registrations import (
    PendingCompanyDenyBody,
    PendingCompanySelfRegistrationOut,
)
from app.domains.company.services.pending_company_registration_service import (
    PendingCompanyRegistrationService,
)
from app.domains.user.models.users import Users

router = APIRouter(prefix="/pending-company-registrations", tags=["Pending company registrations"])


@router.get("", response_model=list[PendingCompanySelfRegistrationOut])
def list_pending(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    _: Users = Depends(require_superadmin),
):
    return crud.list_pending(db, skip=skip, limit=limit, include_deleted=False)


@router.get("/{registration_id}", response_model=PendingCompanySelfRegistrationOut)
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
    company, user = PendingCompanyRegistrationService.approve(db, registration_id, admin.id)
    log_user_action(
        db=db,
        executed_by=admin.id,
        action="approve_pending_company",
        table_name="pending_company_self_registrations",
        table_id=registration_id,
        before_data=None,
        after_data={
            "user_id": str(user.id),
            "email": user.email,
            "company_id": str(company.id),
            "company_name": company.name,
        },
    )
    return {
        "detail": "Application approved; company and owner user created.",
        "user_id": str(user.id),
        "email": user.email,
        "company_id": str(company.id),
        "company_name": company.name,
    }


@router.post("/{registration_id}/deny")
def deny_pending(
    registration_id: UUID,
    body: PendingCompanyDenyBody | None = None,
    db: Session = Depends(get_db),
    admin: Users = Depends(require_superadmin),
):
    _ = body
    PendingCompanyRegistrationService.deny(db, registration_id, admin.id)
    log_user_action(
        db=db,
        executed_by=admin.id,
        action="deny_pending_company",
        table_name="pending_company_self_registrations",
        table_id=registration_id,
        before_data=None,
        after_data=None,
    )
    log_system_event(
        db=db,
        service_name="registration",
        action="deny_pending_company_api",
        status="success",
        details={"registration_id": str(registration_id)},
        executed_by=admin.email,
    )
    return {"detail": "Application denied."}
