from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.logger import log_system_event, log_user_action
from app.core.security import hash_password
from app.domains.auth.models.password_reset_tokens import PasswordResetTokens
from app.utils.email import send_password_reset_email
from app.domains.auth.schemas.password_reset_tokens import (
    PasswordResetConfirmRequest,
    PasswordResetRequest,
    PasswordResetRequestResponse,
)
from app.domains.user.models.users import Users

router = APIRouter(prefix="/password_reset", tags=["Password Reset"])


def _normalize_expires(exp) -> datetime:
    if exp.tzinfo is None:
        return exp.replace(tzinfo=timezone.utc)
    return exp


GENERIC_MSG = (
    "If this email is registered, a password reset link has been sent. "
    "Check your inbox and spam folder."
)
GENERIC_MSG_DEV = (
    GENERIC_MSG + " In development, set PASSWORD_RESET_EXPOSE_TOKEN=true to return the token in the API response."
)


@router.post("/request", response_model=PasswordResetRequestResponse)
def password_reset_request(
    data: PasswordResetRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    try:
        user = (
            db.query(Users)
            .filter(
                Users.email == data.email.strip(),
                Users.is_deleted.is_(False),
            )
            .first()
        )
        if not user:
            return PasswordResetRequestResponse(msg=GENERIC_MSG, reset_token=None)

        token = str(uuid4())
        expires_at = datetime.now(timezone.utc) + timedelta(
            minutes=settings.password_reset_token_expire_minutes
        )
        row = PasswordResetTokens(
            user_id=user.id,
            token=token,
            expires_at=expires_at,
            ip_address=request.client.host if request.client else None,
            user_agent=request.headers.get("user-agent"),
            is_used=False,
            attempts=0,
        )
        db.add(row)
        db.commit()

        mailed = False
        if settings.smtp_username and settings.smtp_password:
            mailed = send_password_reset_email(user.email, token)
            if not mailed:
                log_system_event(
                    db=db,
                    service_name="auth",
                    action="password_reset_email_failed",
                    status="error",
                    details={"user_id": str(user.id), "email": user.email},
                    executed_by="anonymous",
                    ip_address=request.client.host if request.client else None,
                )
        else:
            log_system_event(
                db=db,
                service_name="auth",
                action="password_reset_smtp_skipped",
                status="warning",
                details={"user_id": str(user.id), "reason": "SMTP_USERNAME/SMTP_PASSWORD bos"},
                executed_by="anonymous",
                ip_address=request.client.host if request.client else None,
            )

        log_system_event(
            db=db,
            service_name="auth",
            action="password_reset_request",
            status="success",
            details={"user_id": str(user.id), "email_sent": mailed},
            executed_by=user.email,
            ip_address=request.client.host if request.client else None,
        )

        expose = settings.password_reset_expose_token
        msg_out = GENERIC_MSG_DEV if expose else GENERIC_MSG
        return PasswordResetRequestResponse(
            msg=msg_out,
            reset_token=token if expose else None,
        )
    except Exception as e:
        try:
            db.rollback()
        except Exception:
            pass
        log_system_event(
            db=db,
            service_name="auth",
            action="password_reset_request",
            status="error",
            details={"email": data.email, "error": str(e)},
            executed_by="anonymous",
            ip_address=request.client.host if request.client else None,
        )
        return PasswordResetRequestResponse(msg=GENERIC_MSG, reset_token=None)


@router.get("/validate")
def password_reset_validate(token: str, db: Session = Depends(get_db)):
    db_token = (
        db.query(PasswordResetTokens).filter(PasswordResetTokens.token == token).first()
    )
    if not db_token or db_token.is_used:
        raise HTTPException(status_code=400, detail="Invalid or expired link.")
    exp = _normalize_expires(db_token.expires_at)
    if exp < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invalid or expired link.")
    return {"msg": "Token is valid."}


@router.post("/confirm")
def password_reset_confirm(data: PasswordResetConfirmRequest, db: Session = Depends(get_db)):
    if data.new_password != data.new_password_again:
        raise HTTPException(status_code=400, detail="New passwords do not match.")

    db_token = (
        db.query(PasswordResetTokens).filter(PasswordResetTokens.token == data.token).first()
    )
    now = datetime.now(timezone.utc)
    if not db_token or db_token.is_used:
        raise HTTPException(status_code=400, detail="Invalid or expired link.")
    exp = _normalize_expires(db_token.expires_at)
    if exp < now:
        raise HTTPException(status_code=400, detail="Invalid or expired link.")

    user = db.query(Users).filter(Users.id == db_token.user_id).first()
    if not user:
        raise HTTPException(status_code=400, detail="User not found.")

    before = jsonable_encoder(user)
    user.password = hash_password(data.new_password, settings.password_pepper)
    user.must_change_password = False
    user.is_password_set = True
    db_token.is_used = True
    db_token.used_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)

    log_user_action(
        db=db,
        executed_by=user.id,
        action="password_reset",
        table_name="users",
        table_id=user.id,
        before_data=before,
        after_data=jsonable_encoder(user),
    )
    log_system_event(
        db=db,
        service_name="auth",
        action="password_reset_confirm",
        status="success",
        details={"user_id": str(user.id)},
        executed_by=user.email,
    )

    return {"msg": "Password updated. You can sign in now."}
