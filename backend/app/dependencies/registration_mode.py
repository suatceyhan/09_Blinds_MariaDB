from fastapi import HTTPException, status

from app.core.config import settings


def require_direct_registration_mode() -> None:
    """PUBLIC_REGISTRATION_ENABLED=true iken anında kayıt kullanılır."""
    if not settings.public_registration_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Direct registration is disabled. Use POST /public-registration/employee or "
                "/public-registration/company, verify your email, then sign in after approval."
            ),
        )
