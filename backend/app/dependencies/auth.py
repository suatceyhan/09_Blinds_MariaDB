from typing import Optional
from uuid import UUID

from fastapi import Depends, HTTPException, Path, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.authorization import has_permission
from app.core.config import settings
from app.core.database import get_db
from app.core.security import decode_token
from app.core.tenant_rls import refresh_tenant_rls_context
from app.domains.auth.models.revoked_tokens import RevokedTokens
from app.domains.user.models.users import Users
from app.domains.user.services.company_membership import user_has_membership

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)
SECRET_KEY = settings.secret_key


def effective_company_id(user: Users) -> Optional[UUID]:
    """Oturum şirketi: JWT `active_company_id` (üyelik geçerliyse), yoksa `users.company_id`."""
    jwt_c = getattr(user, "_jwt_active_company_id", None)
    if jwt_c is not None:
        return jwt_c
    return user.company_id


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> Users:
    payload = decode_token(token, secret_key=SECRET_KEY, db=db, revoked_model=RevokedTokens)
    if not payload or "user_id" not in payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid, expired or revoked token",
        )
    user_id = payload["user_id"]
    if not isinstance(user_id, UUID):
        try:
            user_id = UUID(str(user_id))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid user ID in token",
            )
    user = db.query(Users).filter(Users.id == user_id, Users.is_deleted.is_(False)).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or deleted",
        )
    user.roles = payload.get("roles", [])
    user.active_role = payload.get("active_role")
    user.must_change_password = payload.get("must_change_password", False)
    if payload.get("email"):
        user.email = payload["email"]
    raw_company = payload.get("active_company_id")
    jwt_company: Optional[UUID] = None
    if raw_company:
        try:
            parsed = UUID(str(raw_company))
            if user_has_membership(db, user.id, parsed):
                jwt_company = parsed
        except ValueError:
            pass
    user._jwt_active_company_id = jwt_company
    rls_company = jwt_company if jwt_company is not None else user.company_id
    refresh_tenant_rls_context(
        db, user, rls_company, active_role=getattr(user, "active_role", None)
    )
    return user


def get_verified_user(
    request: Request,
    current_user: Users = Depends(get_current_user),
) -> Users:
    if current_user.must_change_password and not request.url.path.startswith(
        "/auth/change_password"
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Password change required before accessing the system.",
        )
    return current_user


def get_self_user(current_user: Users = Depends(get_current_user)) -> Users:
    return current_user


def get_user_or_owner(
    user_id: str,
    current_user: Users = Depends(get_current_user),
) -> Users:
    if str(current_user.id) != str(user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied",
        )
    return current_user


def get_user_or_owner_dependency(
    user_id: str = Path(...),
    current_user: Users = Depends(get_current_user),
) -> Users:
    if str(current_user.id) == str(user_id):
        return current_user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You do not have permission to access this resource.",
    )


def require_permissions(*required_permissions: str):
    def dependency(
        db: Session = Depends(get_db),
        current_user: Users = Depends(get_current_user),
    ):
        active = getattr(current_user, "active_role", None)
        for perm in required_permissions:
            if has_permission(db, current_user.id, perm, active_role=active):
                return current_user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Requires one of permissions: {required_permissions}",
        )

    return dependency


def get_current_user_optional(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> Optional[Users]:
    try:
        payload = decode_token(token, secret_key=SECRET_KEY, db=db, revoked_model=RevokedTokens)
        if not payload or "user_id" not in payload:
            return None
        user_id = payload["user_id"]
        if not isinstance(user_id, UUID):
            user_id = UUID(str(user_id))
        user = db.query(Users).filter(Users.id == user_id, Users.is_deleted.is_(False)).first()
        if not user:
            return None
        user.roles = payload.get("roles", [])
        user.active_role = payload.get("active_role")
        user.must_change_password = payload.get("must_change_password", False)
        if payload.get("email"):
            user.email = payload["email"]
        raw_company = payload.get("active_company_id")
        jwt_company: Optional[UUID] = None
        if raw_company:
            try:
                parsed = UUID(str(raw_company))
                if user_has_membership(db, user.id, parsed):
                    jwt_company = parsed
            except ValueError:
                pass
        user._jwt_active_company_id = jwt_company
        rls_company = jwt_company if jwt_company is not None else user.company_id
        refresh_tenant_rls_context(
            db, user, rls_company, active_role=getattr(user, "active_role", None)
        )
        return user
    except Exception:
        return None


def require_superadmin(
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
) -> Users:
    from app.core.authorization import is_effective_superadmin

    if not is_effective_superadmin(
        db, current_user.id, getattr(current_user, "active_role", None)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This action requires superadmin to be your active role.",
        )
    return current_user
