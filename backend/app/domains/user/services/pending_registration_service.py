import secrets
import string
from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logger import log_system_event
from app.core.security import hash_password
from app.domains.lookup.models.roles import Roles
from app.domains.user.crud import pending_employee_self_registrations as crud
from app.domains.user.models.pending_employee_self_registrations import (
    PendingEmployeeSelfRegistrations,
)
from app.domains.user.models.user_roles import UserRoles
from app.domains.user.models.users import Users
from app.domains.user.schemas.pending_employee_self_registrations import (
    PendingEmployeeSelfRegistrationCreate,
)
from app.shared.enums import PendingStatus


class PendingRegistrationService:
    @staticmethod
    def generate_verification_token(length: int = 64) -> str:
        alphabet = string.ascii_letters + string.digits
        return "".join(secrets.choice(alphabet) for _ in range(length))

    @staticmethod
    def create_pending_employee_registration(
        db: Session,
        data: PendingEmployeeSelfRegistrationCreate,
    ) -> PendingEmployeeSelfRegistrations:
        email = data.email.strip().lower()
        if (
            db.query(Users)
            .filter(
                Users.is_deleted.is_(False),
                func.lower(Users.email) == email,
            )
            .first()
        ):
            raise HTTPException(status_code=400, detail="This email address is already in use.")

        if db.query(Users).filter(Users.phone == data.phone.strip(), Users.is_deleted.is_(False)).first():
            raise HTTPException(status_code=400, detail="This phone number is already in use.")

        if crud.get_pending_by_email(db, email):
            raise HTTPException(status_code=400, detail="A pending application for this email already exists.")

        token = PendingRegistrationService.generate_verification_token()
        pwd_hash = hash_password(data.password, settings.password_pepper)
        return crud.create_pending(db, data, password_hash=pwd_hash, verification_token=token)

    @staticmethod
    def verify_email(db: Session, token: str) -> PendingEmployeeSelfRegistrations:
        row = crud.get_pending_by_token(db, token)
        if not row:
            raise HTTPException(status_code=400, detail="Invalid or expired verification link.")
        if row.is_email_verified:
            raise HTTPException(status_code=400, detail="Email is already verified.")
        updated = crud.mark_verified(db, row.id)
        if not updated:
            raise HTTPException(status_code=400, detail="Could not update verification state.")
        log_system_event(
            db=db,
            service_name="registration",
            action="verify_email_pending_employee",
            status="success",
            details={"registration_id": str(row.id), "email": row.email},
            executed_by="self_registration",
        )
        return updated

    @staticmethod
    def approve(
        db: Session,
        registration_id: UUID,
        approved_by: UUID,
    ) -> Users:
        row = crud.get_pending(db, registration_id)
        if not row or row.is_deleted:
            raise HTTPException(status_code=404, detail="Application not found.")
        if row.pending_status == PendingStatus.APPROVED.value:
            raise HTTPException(status_code=400, detail="Application is already approved.")
        if row.pending_status == PendingStatus.DENIED.value:
            raise HTTPException(status_code=400, detail="Application was denied.")
        if not row.is_email_verified:
            raise HTTPException(status_code=400, detail="Email has not been verified.")

        role_name = (settings.default_registered_role_name or "user").strip()
        role = (
            db.query(Roles)
            .filter(Roles.name == role_name, Roles.is_deleted.is_(False))
            .first()
        )
        if not role:
            raise HTTPException(
                status_code=503,
                detail="Default role is not configured. Restart the server after bootstrap.",
            )

        if (
            db.query(Users)
            .filter(
                Users.is_deleted.is_(False),
                func.lower(Users.email) == row.email.lower(),
            )
            .first()
        ):
            raise HTTPException(status_code=400, detail="A user with this email already exists.")

        if db.query(Users).filter(Users.phone == row.phone.strip(), Users.is_deleted.is_(False)).first():
            raise HTTPException(status_code=400, detail="A user with this phone number already exists.")

        user = Users(
            first_name=row.first_name,
            last_name=row.last_name,
            email=row.email.strip().lower(),
            phone=row.phone.strip(),
            password=row.password,
            is_password_set=True,
            must_change_password=False,
            is_deleted=False,
            is_first_login=True,
            default_role=role.id,
            role_group_id=row.role_group_id,
            created_by=approved_by,
            updated_by=approved_by,
        )
        db.add(user)
        db.flush()
        db.add(
            UserRoles(
                user_id=user.id,
                role_id=role.id,
                is_deleted=False,
                created_by=approved_by,
                updated_by=approved_by,
            )
        )
        row.pending_status = PendingStatus.APPROVED.value
        row.approved_by = approved_by
        row.approved_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(user)

        log_system_event(
            db=db,
            service_name="registration",
            action="approve_pending_employee",
            status="success",
            details={"registration_id": str(registration_id), "user_id": str(user.id)},
            executed_by=str(approved_by),
        )
        return user

    @staticmethod
    def deny(db: Session, registration_id: UUID, denied_by: UUID) -> PendingEmployeeSelfRegistrations:
        row = crud.get_pending(db, registration_id)
        if not row or row.is_deleted:
            raise HTTPException(status_code=404, detail="Application not found.")
        if row.pending_status == PendingStatus.APPROVED.value:
            raise HTTPException(status_code=400, detail="Application is already approved.")
        updated = crud.mark_denied(db, registration_id, denied_by)
        if not updated:
            raise HTTPException(status_code=400, detail="Could not deny the application.")
        log_system_event(
            db=db,
            service_name="registration",
            action="deny_pending_employee",
            status="success",
            details={"registration_id": str(registration_id)},
            executed_by=str(denied_by),
        )
        return updated
