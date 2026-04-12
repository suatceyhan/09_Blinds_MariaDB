from typing import Optional
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.domains.user.models.pending_employee_self_registrations import (
    PendingEmployeeSelfRegistrations,
)
from app.domains.user.schemas.pending_employee_self_registrations import (
    PendingEmployeeSelfRegistrationCreate,
)
from app.shared.enums import PendingStatus


def list_pending(
    db: Session,
    *,
    skip: int = 0,
    limit: int = 100,
    include_deleted: bool = False,
) -> list[PendingEmployeeSelfRegistrations]:
    q = db.query(PendingEmployeeSelfRegistrations)
    if not include_deleted:
        q = q.filter(PendingEmployeeSelfRegistrations.is_deleted.is_(False))
    return q.order_by(PendingEmployeeSelfRegistrations.requested_at.desc()).offset(skip).limit(limit).all()


def get_pending(db: Session, registration_id: UUID) -> Optional[PendingEmployeeSelfRegistrations]:
    return (
        db.query(PendingEmployeeSelfRegistrations)
        .filter(PendingEmployeeSelfRegistrations.id == registration_id)
        .first()
    )


def get_pending_by_email(db: Session, email: str) -> Optional[PendingEmployeeSelfRegistrations]:
    el = email.strip().lower()
    return (
        db.query(PendingEmployeeSelfRegistrations)
        .filter(
            PendingEmployeeSelfRegistrations.is_deleted.is_(False),
            func.lower(PendingEmployeeSelfRegistrations.email) == el,
        )
        .first()
    )


def get_pending_by_token(db: Session, token: str) -> Optional[PendingEmployeeSelfRegistrations]:
    return (
        db.query(PendingEmployeeSelfRegistrations)
        .filter(
            PendingEmployeeSelfRegistrations.verification_token == token,
            PendingEmployeeSelfRegistrations.is_deleted.is_(False),
        )
        .first()
    )


def create_pending(
    db: Session,
    data: PendingEmployeeSelfRegistrationCreate,
    *,
    password_hash: str,
    verification_token: str,
) -> PendingEmployeeSelfRegistrations:
    row = PendingEmployeeSelfRegistrations(
        first_name=data.first_name.strip(),
        last_name=data.last_name.strip(),
        email=data.email.strip().lower(),
        phone=data.phone.strip(),
        password=password_hash,
        role_group_id=data.role_group_id,
        request_note=data.request_note.strip() if data.request_note else None,
        verification_token=verification_token,
        is_email_verified=False,
        pending_status=PendingStatus.EMAIL_NOT_VERIFIED.value,
        is_deleted=False,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def mark_verified(db: Session, registration_id: UUID) -> Optional[PendingEmployeeSelfRegistrations]:
    row = get_pending(db, registration_id)
    if not row:
        return None
    from datetime import datetime, timezone

    row.is_email_verified = True
    row.email_verified_at = datetime.now(timezone.utc)
    row.pending_status = PendingStatus.PENDING_APPROVAL.value
    db.commit()
    db.refresh(row)
    return row


def mark_denied(
    db: Session,
    registration_id: UUID,
    denied_by: UUID,
) -> Optional[PendingEmployeeSelfRegistrations]:
    row = get_pending(db, registration_id)
    if not row:
        return None
    from datetime import datetime, timezone

    row.pending_status = PendingStatus.DENIED.value
    row.approved_by = denied_by
    row.approved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return row


def soft_delete(db: Session, registration_id: UUID) -> bool:
    row = get_pending(db, registration_id)
    if not row:
        return False
    row.is_deleted = True
    db.commit()
    return True
