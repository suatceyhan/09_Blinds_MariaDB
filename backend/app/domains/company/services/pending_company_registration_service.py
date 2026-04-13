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
from app.domains.business_lookups.services.estimate_status_defaults import (
    ensure_default_estimate_statuses_for_company,
)
from app.domains.company.models.company import Companies
from app.domains.company.models.pending_company_self_registrations import (
    PendingCompanySelfRegistrations,
)
from app.domains.company.crud import pending_company_self_registrations as crud
from app.domains.company.schemas.pending_company_self_registrations import (
    PendingCompanySelfRegistrationCreate,
)
from app.domains.lookup.models.roles import Roles
from app.domains.user.models.user_roles import UserRoles
from app.domains.user.models.users import Users
from app.shared.enums import PendingStatus


class PendingCompanyRegistrationService:
    @staticmethod
    def generate_verification_token(length: int = 64) -> str:
        alphabet = string.ascii_letters + string.digits
        return "".join(secrets.choice(alphabet) for _ in range(length))

    @staticmethod
    def create_pending_company_registration(
        db: Session,
        data: PendingCompanySelfRegistrationCreate,
    ) -> PendingCompanySelfRegistrations:
        email = data.email.strip().lower()
        if (
            db.query(Users)
            .filter(Users.is_deleted.is_(False), func.lower(Users.email) == email)
            .first()
        ):
            raise HTTPException(status_code=400, detail="This email address is already in use.")

        if db.query(Users).filter(Users.phone == data.phone.strip(), Users.is_deleted.is_(False)).first():
            raise HTTPException(status_code=400, detail="This phone number is already in use.")

        cname = data.company_name.strip()
        if crud.get_pending_by_company_name(db, cname):
            raise HTTPException(
                status_code=400,
                detail="A pending application for this company name already exists.",
            )
        if (
            db.query(Companies)
            .filter(
                Companies.is_deleted.is_(False),
                func.lower(Companies.name) == cname.lower(),
            )
            .first()
        ):
            raise HTTPException(status_code=400, detail="This company name is already registered.")

        if crud.get_pending_by_email(db, email):
            raise HTTPException(status_code=400, detail="A pending application for this email already exists.")

        token = PendingCompanyRegistrationService.generate_verification_token()
        pwd_hash = hash_password(data.password, settings.password_pepper)
        row = crud.create_pending(db, data, password_hash=pwd_hash, verification_token=token)
        log_system_event(
            db=db,
            service_name="registration",
            action="create_pending_company_registration",
            status="success",
            details={"registration_id": str(row.id), "email": row.email, "company_name": row.company_name},
            executed_by="self_registration",
        )
        return row

    @staticmethod
    def verify_email(db: Session, token: str) -> PendingCompanySelfRegistrations:
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
            action="verify_email_pending_company",
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
    ) -> tuple[Companies, Users]:
        owname = (settings.default_company_owner_role_name or "admin").strip()
        role = (
            db.query(Roles)
            .filter(Roles.name == owname, Roles.is_deleted.is_(False))
            .first()
        )
        if not role:
            raise HTTPException(
                status_code=503,
                detail="Company owner role is not configured. Set DEFAULT_COMPANY_OWNER_ROLE_NAME or create the role.",
            )

        row = crud.get_pending(db, registration_id)
        if not row or row.is_deleted:
            raise HTTPException(status_code=404, detail="Application not found.")
        if row.pending_status == PendingStatus.APPROVED.value:
            raise HTTPException(status_code=400, detail="Application is already approved.")
        if row.pending_status == PendingStatus.DENIED.value:
            raise HTTPException(status_code=400, detail="Application was denied.")
        if not row.is_email_verified:
            raise HTTPException(status_code=400, detail="Email has not been verified.")

        el = row.email.strip().lower()
        if (
            db.query(Users)
            .filter(Users.is_deleted.is_(False), func.lower(Users.email) == el)
            .first()
        ):
            raise HTTPException(status_code=400, detail="A user with this email already exists.")
        if db.query(Users).filter(Users.phone == row.phone.strip(), Users.is_deleted.is_(False)).first():
            raise HTTPException(status_code=400, detail="A user with this phone number already exists.")

        if (
            db.query(Companies)
            .filter(
                Companies.is_deleted.is_(False),
                func.lower(Companies.name) == row.company_name.strip().lower(),
            )
            .first()
        ):
            raise HTTPException(status_code=400, detail="This company name is already registered.")

        company = Companies(
            name=row.company_name.strip(),
            phone=row.company_phone.strip() if row.company_phone else None,
            website=row.website.strip() if row.website else None,
            email=el,
            is_deleted=False,
        )
        db.add(company)
        db.flush()
        ensure_default_estimate_statuses_for_company(db, company.id)

        user = Users(
            first_name=row.first_name,
            last_name=row.last_name,
            email=el,
            phone=row.phone.strip(),
            password=row.password,
            company_id=company.id,
            is_password_set=True,
            must_change_password=False,
            is_deleted=False,
            is_first_login=True,
            default_role=role.id,
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
        from app.domains.user.services.company_membership import ensure_membership

        ensure_membership(db, user.id, company.id, commit=False)
        row.pending_status = PendingStatus.APPROVED.value
        row.approved_by = approved_by
        row.approved_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(company)
        db.refresh(user)

        log_system_event(
            db=db,
            service_name="registration",
            action="approve_pending_company",
            status="success",
            details={
                "registration_id": str(registration_id),
                "user_id": str(user.id),
                "company_id": str(company.id),
            },
            executed_by=str(approved_by),
        )
        return company, user

    @staticmethod
    def deny(db: Session, registration_id: UUID, denied_by: UUID) -> PendingCompanySelfRegistrations:
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
            action="deny_pending_company",
            status="success",
            details={"registration_id": str(registration_id)},
            executed_by=str(denied_by),
        )
        return updated
