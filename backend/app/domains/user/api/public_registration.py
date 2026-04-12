from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.logger import log_system_event
from app.domains.company.schemas.pending_company_self_registrations import (
    PendingCompanySelfRegistrationCreate,
    PendingCompanySelfRegistrationCreated,
)
from app.domains.company.services.pending_company_registration_service import (
    PendingCompanyRegistrationService,
)
from app.domains.user.schemas.pending_employee_self_registrations import (
    PendingEmployeeSelfRegistrationCreate,
    PendingEmployeeSelfRegistrationCreated,
)
from app.domains.user.services.pending_registration_service import PendingRegistrationService
from app.utils.email import send_verification_email_task

router = APIRouter(prefix="/public-registration", tags=["Public Registration"])

EMAIL_VERIFICATION_FAILED = "Email verification failed."


class EmailVerificationRequest(BaseModel):
    token: str


class RegistrationOptionsOut(BaseModel):
    """Whether `POST /auth/register` (instant account) is allowed. Employee/company pending flows stay available regardless (DWP-style)."""

    direct_registration_enabled: bool


@router.get("/options", response_model=RegistrationOptionsOut)
def registration_options():
    return RegistrationOptionsOut(direct_registration_enabled=settings.public_registration_enabled)


@router.post("/employee", response_model=PendingEmployeeSelfRegistrationCreated)
def create_pending_employee_registration(
    registration: PendingEmployeeSelfRegistrationCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db),
):
    pending = PendingRegistrationService.create_pending_employee_registration(db, registration)

    background_tasks.add_task(
        send_verification_email_task,
        pending.email,
        f"{pending.first_name} {pending.last_name}",
        pending.verification_token,
        "employee",
    )

    log_system_event(
        db=db,
        service_name="registration",
        action="create_pending_employee_registration_api",
        status="success",
        details={"registration_id": str(pending.id), "email": pending.email},
        executed_by="self_registration",
        ip_address=request.client.host if request.client else None,
    )

    return PendingEmployeeSelfRegistrationCreated(
        id=pending.id,
        email=pending.email,
    )


@router.get("/verify-employee-email")
def verify_employee_email_get(token: str, request: Request, db: Session = Depends(get_db)):
    try:
        verified = PendingRegistrationService.verify_email(db, token)
        return {
            "message": "Email verified. Your application is pending admin approval.",
            "registration_id": str(verified.id),
            "email": verified.email,
        }
    except HTTPException:
        raise
    except Exception as e:
        log_system_event(
            db=db,
            service_name="registration",
            action="verify_email_pending_employee_api",
            status="error",
            details={"token": token, "error": str(e)},
            executed_by="system",
            ip_address=request.client.host if request.client else None,
        )
        raise HTTPException(status_code=400, detail=EMAIL_VERIFICATION_FAILED) from e


@router.post("/verify-employee-email")
def verify_employee_email_post(
    request: Request,
    db: Session = Depends(get_db),
    verification_data: EmailVerificationRequest | None = Body(None),
    token: str | None = None,
):
    verification_token = token or (verification_data.token if verification_data else None)
    if not verification_token:
        raise HTTPException(status_code=400, detail="Token is required.")
    try:
        verified = PendingRegistrationService.verify_email(db, verification_token)
        return {
            "message": "Email verified. Your application is pending admin approval.",
            "registration_id": str(verified.id),
            "email": verified.email,
        }
    except HTTPException:
        raise
    except Exception as e:
        log_system_event(
            db=db,
            service_name="registration",
            action="verify_email_pending_employee_api",
            status="error",
            details={"token": verification_token, "error": str(e)},
            executed_by="system",
            ip_address=request.client.host if request else None,
        )
        raise HTTPException(status_code=400, detail=EMAIL_VERIFICATION_FAILED) from e


@router.post("/company", response_model=PendingCompanySelfRegistrationCreated)
def create_pending_company_registration(
    registration: PendingCompanySelfRegistrationCreate,
    background_tasks: BackgroundTasks,
    request: Request,
    db: Session = Depends(get_db),
):
    pending = PendingCompanyRegistrationService.create_pending_company_registration(db, registration)
    background_tasks.add_task(
        send_verification_email_task,
        pending.email,
        f"{pending.first_name} {pending.last_name}",
        pending.verification_token,
        "company",
    )
    log_system_event(
        db=db,
        service_name="registration",
        action="create_pending_company_registration_api",
        status="success",
        details={
            "registration_id": str(pending.id),
            "email": pending.email,
            "company_name": pending.company_name,
        },
        executed_by="self_registration",
        ip_address=request.client.host if request.client else None,
    )
    return PendingCompanySelfRegistrationCreated(id=pending.id, email=pending.email)


@router.get("/verify-company-email")
def verify_company_email_get(token: str, request: Request, db: Session = Depends(get_db)):
    try:
        verified = PendingCompanyRegistrationService.verify_email(db, token)
        return {
            "message": "Email verified. Your company application is pending admin approval.",
            "registration_id": str(verified.id),
            "email": verified.email,
            "company_name": verified.company_name,
        }
    except HTTPException:
        raise
    except Exception as e:
        log_system_event(
            db=db,
            service_name="registration",
            action="verify_email_pending_company_api",
            status="error",
            details={"token": token, "error": str(e)},
            executed_by="system",
            ip_address=request.client.host if request.client else None,
        )
        raise HTTPException(status_code=400, detail=EMAIL_VERIFICATION_FAILED) from e


@router.post("/verify-company-email")
def verify_company_email_post(
    request: Request,
    db: Session = Depends(get_db),
    verification_data: EmailVerificationRequest | None = Body(None),
    token: str | None = None,
):
    verification_token = token or (verification_data.token if verification_data else None)
    if not verification_token:
        raise HTTPException(status_code=400, detail="Token is required.")
    try:
        verified = PendingCompanyRegistrationService.verify_email(db, verification_token)
        return {
            "message": "Email verified. Your company application is pending admin approval.",
            "registration_id": str(verified.id),
            "email": verified.email,
            "company_name": verified.company_name,
        }
    except HTTPException:
        raise
    except Exception as e:
        log_system_event(
            db=db,
            service_name="registration",
            action="verify_email_pending_company_api",
            status="error",
            details={"token": verification_token, "error": str(e)},
            executed_by="system",
            ip_address=request.client.host if request else None,
        )
        raise HTTPException(status_code=400, detail=EMAIL_VERIFICATION_FAILED) from e
