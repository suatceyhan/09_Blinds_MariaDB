from typing import Optional
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.domains.company.models.pending_company_self_registrations import (
    PendingCompanySelfRegistrations,
)
from app.domains.company.schemas.pending_company_self_registrations import (
    PendingCompanySelfRegistrationCreate,
)
from app.shared.enums import PendingStatus


def list_pending(
    db: Session,
    *,
    skip: int = 0,
    limit: int = 100,
    include_deleted: bool = False,
) -> list[PendingCompanySelfRegistrations]:
    q = db.query(PendingCompanySelfRegistrations)
    if not include_deleted:
        q = q.filter(PendingCompanySelfRegistrations.is_deleted.is_(False))
    return (
        q.order_by(PendingCompanySelfRegistrations.requested_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


def get_pending(db: Session, registration_id: UUID) -> Optional[PendingCompanySelfRegistrations]:
    return (
        db.query(PendingCompanySelfRegistrations)
        .filter(PendingCompanySelfRegistrations.id == registration_id)
        .first()
    )


def get_pending_by_email(db: Session, email: str) -> Optional[PendingCompanySelfRegistrations]:
    el = email.strip().lower()
    return (
        db.query(PendingCompanySelfRegistrations)
        .filter(
            PendingCompanySelfRegistrations.is_deleted.is_(False),
            func.lower(PendingCompanySelfRegistrations.email) == el,
            PendingCompanySelfRegistrations.pending_status.in_(
                [
                    PendingStatus.EMAIL_NOT_VERIFIED.value,
                    PendingStatus.PENDING_APPROVAL.value,
                ]
            ),
        )
        .first()
    )


def get_pending_by_company_name(db: Session, company_name: str) -> Optional[PendingCompanySelfRegistrations]:
    n = company_name.strip().lower()
    return (
        db.query(PendingCompanySelfRegistrations)
        .filter(
            PendingCompanySelfRegistrations.is_deleted.is_(False),
            func.lower(PendingCompanySelfRegistrations.company_name) == n,
            PendingCompanySelfRegistrations.pending_status.in_(
                [
                    PendingStatus.EMAIL_NOT_VERIFIED.value,
                    PendingStatus.PENDING_APPROVAL.value,
                ]
            ),
        )
        .first()
    )


def get_pending_by_token(db: Session, token: str) -> Optional[PendingCompanySelfRegistrations]:
    return (
        db.query(PendingCompanySelfRegistrations)
        .filter(
            PendingCompanySelfRegistrations.verification_token == token,
            PendingCompanySelfRegistrations.is_deleted.is_(False),
        )
        .first()
    )


def create_pending(
    db: Session,
    data: PendingCompanySelfRegistrationCreate,
    *,
    password_hash: str,
    verification_token: str,
) -> PendingCompanySelfRegistrations:
    row = PendingCompanySelfRegistrations(
        first_name=data.first_name.strip(),
        last_name=data.last_name.strip(),
        email=data.email.strip().lower(),
        phone=data.phone.strip(),
        password=password_hash,
        company_name=data.company_name.strip(),
        company_phone=data.company_phone.strip() if data.company_phone else None,
        website=data.website.strip() if data.website else None,
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


def mark_verified(db: Session, registration_id: UUID) -> Optional[PendingCompanySelfRegistrations]:
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
) -> Optional[PendingCompanySelfRegistrations]:
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
