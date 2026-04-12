from typing import Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.domains.auth.models.login_attempts import LoginAttempts
from app.domains.auth.schemas.login_attempts import LoginAttemptCreate


def create_login_attempt(db: Session, attempt_in: LoginAttemptCreate) -> LoginAttempts:
    db_attempt = LoginAttempts(**attempt_in.model_dump())
    db.add(db_attempt)
    db.commit()
    db.refresh(db_attempt)
    return db_attempt


def log_login_attempt(
    db: Session,
    user_id: Optional[UUID],
    ip_address: Optional[str],
    user_agent: Optional[str],
    success: bool,
) -> LoginAttempts:
    attempt_in = LoginAttemptCreate(
        user_id=user_id,
        ip_address=ip_address,
        user_agent=user_agent,
        success=success,
    )
    return create_login_attempt(db, attempt_in)
