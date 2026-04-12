from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Body, Depends, Form, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.core.authorization import get_user_permissions
from app.core.config import settings
from app.core.database import get_db
from app.core.limiting import limiter
from app.core.logger import log_system_event, log_user_action
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    revoke_token,
)
from app.dependencies.auth import get_current_user, get_self_user
from app.dependencies.registration_mode import require_direct_registration_mode
from app.domains.auth.crud.login_attempts import log_login_attempt
from app.domains.auth.crud.user_auth import authenticate_user
from app.domains.auth.crud.user_sessions import deactivate_all_sessions_for_user
from app.domains.auth.models.revoked_tokens import RevokedTokens
from app.domains.company.models.company import Companies
from app.domains.lookup.models.roles import Roles
from app.domains.user.models.user_roles import UserRoles
from app.domains.user.models.users import Users
from app.domains.user.services.company_membership import list_user_companies_for_me, user_has_membership
from app.domains.user.schemas.users import (
    RefreshTokenRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])

BEARER_PREFIX = "Bearer "


def _issue_tokens(user_auth: Users, db: Session) -> dict:
    roles_rows = (
        db.query(Roles.name)
        .join(UserRoles, UserRoles.role_id == Roles.id)
        .filter(
            UserRoles.user_id == user_auth.id,
            UserRoles.is_deleted.is_(False),
            Roles.is_deleted.is_(False),
        )
        .all()
    )
    role_names = [r.name for r in roles_rows]

    active_role = None
    if user_auth.default_role:
        role_obj = (
            db.query(Roles)
            .filter(Roles.id == user_auth.default_role, Roles.is_deleted.is_(False))
            .first()
        )
        if role_obj:
            active_role = role_obj.name
    if not active_role and role_names:
        active_role = role_names[0]

    permissions = get_user_permissions(db, user_auth.id, active_role)

    active_company_id = user_auth.company_id
    access_token = create_access_token(
        data={
            "user_id": user_auth.id,
            "email": user_auth.email,
            "roles": role_names,
            "permissions": permissions,
            "must_change_password": user_auth.must_change_password,
            "active_role": active_role,
            "active_company_id": str(active_company_id) if active_company_id else None,
        },
    )
    refresh_token = create_refresh_token(
        data={"user_id": str(user_auth.id)},
        expires_delta=settings.refresh_token_expire_minutes * 60,
    )
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "must_change_password": user_auth.must_change_password,
        "roles": role_names,
        "default_role": user_auth.default_role,
        "active_role": active_role,
    }


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
def login(
    request: Request,
    email: str = Form(...),
    password: str = Form(...),
    db: Session = Depends(get_db),
):
    ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    user = db.query(Users).filter(Users.email == email).first()
    user_id = user.id if user else None

    if not user:
        log_login_attempt(
            db=db,
            user_id=user_id,
            ip_address=ip,
            user_agent=user_agent,
            success=False,
        )
        raise HTTPException(status_code=400, detail="Invalid email or password")

    if user.is_deleted:
        log_login_attempt(
            db=db,
            user_id=user_id,
            ip_address=ip,
            user_agent=user_agent,
            success=False,
        )
        raise HTTPException(status_code=400, detail="Account has been deactivated")

    if user.account_locked_until and user.account_locked_until > datetime.utcnow():
        log_login_attempt(
            db=db,
            user_id=user_id,
            ip_address=ip,
            user_agent=user_agent,
            success=False,
        )
        raise HTTPException(
            status_code=400,
            detail="Account is temporarily locked due to multiple failed attempts",
        )

    user_auth = authenticate_user(db, email, password, pepper=settings.password_pepper)

    log_login_attempt(
        db=db,
        user_id=user_id,
        ip_address=ip,
        user_agent=user_agent,
        success=bool(user_auth),
    )

    if not user_auth:
        raise HTTPException(status_code=400, detail="Invalid email or password")

    from app.domains.user.services.company_membership import normalize_active_company

    normalize_active_company(db, user_auth)
    db.refresh(user_auth)

    out = _issue_tokens(user_auth, db)
    log_system_event(
        db=db,
        service_name="auth",
        action="login",
        status="success",
        details={"user_id": str(user_auth.id)},
        executed_by=user_auth.email,
        ip_address=ip,
    )
    return out


@router.post("/register", response_model=TokenResponse)
@limiter.limit("10/minute")
def register(
    request: Request,
    data: RegisterRequest,
    db: Session = Depends(get_db),
    _: None = Depends(require_direct_registration_mode),
):

    role_name = (settings.default_registered_role_name or "user").strip()
    role = (
        db.query(Roles)
        .filter(Roles.name == role_name, Roles.is_deleted.is_(False))
        .first()
    )
    if not role:
        raise HTTPException(
            status_code=503,
            detail="Default user role is not configured yet. Restart the server after bootstrap.",
        )

    email = data.email.strip()
    if db.query(Users).filter(Users.email == email, Users.is_deleted.is_(False)).first():
        raise HTTPException(status_code=400, detail="An account with this email already exists.")

    phone = data.phone.strip()
    if db.query(Users).filter(Users.phone == phone, Users.is_deleted.is_(False)).first():
        raise HTTPException(status_code=400, detail="This phone number is already in use.")

    user = Users(
        first_name=data.first_name.strip(),
        last_name=data.last_name.strip(),
        phone=phone,
        email=email,
        password=hash_password(data.password, settings.password_pepper),
        is_password_set=True,
        must_change_password=False,
        is_deleted=False,
        default_role=role.id,
    )
    db.add(user)
    db.flush()
    db.add(UserRoles(user_id=user.id, role_id=role.id, is_deleted=False))
    db.commit()
    db.refresh(user)

    log_system_event(
        db=db,
        service_name="auth",
        action="register",
        status="success",
        details={"user_id": str(user.id)},
        executed_by=user.email,
        ip_address=request.client.host if request.client else None,
    )

    return _issue_tokens(user, db)


@router.post("/refresh", response_model=TokenResponse)
def refresh_tokens(
    data: RefreshTokenRequest,
    db: Session = Depends(get_db),
):
    payload = decode_token(
        data.refresh_token,
        secret_key=settings.secret_key,
        db=None,
        revoked_model=None,
    )
    if not payload or "user_id" not in payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )
    uid = payload["user_id"]
    user_auth = db.query(Users).filter(Users.id == uid, Users.is_deleted.is_(False)).first()
    if not user_auth:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or deleted",
        )
    from app.domains.user.services.company_membership import normalize_active_company

    normalize_active_company(db, user_auth)
    db.refresh(user_auth)
    return _issue_tokens(user_auth, db)


@router.get("/me", response_model=UserResponse)
def get_me(
    request: Request,
    current_user: Users = Depends(get_self_user),
    db: Session = Depends(get_db),
):
    roles = (
        db.query(Roles.name)
        .join(UserRoles, UserRoles.role_id == Roles.id)
        .filter(
            UserRoles.user_id == current_user.id,
            UserRoles.is_deleted.is_(False),
            Roles.is_deleted.is_(False),
        )
        .all()
    )
    role_names = [r.name for r in roles]
    token = request.headers.get("Authorization")
    if token and token.startswith(BEARER_PREFIX):
        token = token.replace(BEARER_PREFIX, "")
    else:
        token = None

    active_role = get_active_role(token, current_user, role_names, db)

    default_role_name = None
    if current_user.default_role:
        role_obj = (
            db.query(Roles)
            .filter(Roles.id == current_user.default_role, Roles.is_deleted.is_(False))
            .first()
        )
        if role_obj:
            default_role_name = role_obj.name

    permission_names = get_user_permissions(db, current_user.id, active_role)

    company_id = current_user.company_id
    company_name = None
    company_country_code: Optional[str] = None
    if company_id:
        co = db.query(Companies).filter(Companies.id == company_id, Companies.is_deleted.is_(False)).first()
        if co:
            company_name = co.name
            raw_cc = getattr(co, "country_code", None)
            if isinstance(raw_cc, str) and len(raw_cc.strip()) == 2 and raw_cc.strip().isalpha():
                company_country_code = raw_cc.strip().upper()

    active_company_id: Optional[UUID] = None
    active_company_name: Optional[str] = None
    active_company_country_code: Optional[str] = None
    if token:
        tp = decode_token(
            token,
            secret_key=settings.secret_key,
            db=db,
            revoked_model=RevokedTokens,
        )
        if tp and tp.get("active_company_id"):
            try:
                aid = UUID(str(tp["active_company_id"]))
                if user_has_membership(db, current_user.id, aid):
                    aco = (
                        db.query(Companies)
                        .filter(Companies.id == aid, Companies.is_deleted.is_(False))
                        .first()
                    )
                    if aco:
                        active_company_id = aid
                        active_company_name = aco.name
                        acc = getattr(aco, "country_code", None)
                        if isinstance(acc, str) and len(acc.strip()) == 2 and acc.strip().isalpha():
                            active_company_country_code = acc.strip().upper()
            except ValueError:
                pass
    if active_company_id is None:
        active_company_id = company_id
        active_company_name = company_name
        active_company_country_code = company_country_code

    companies_me = [{"id": cid, "name": cname} for cid, cname in list_user_companies_for_me(db, current_user.id)]

    return {
        "id": current_user.id,
        "first_name": current_user.first_name,
        "last_name": current_user.last_name,
        "phone": current_user.phone,
        "email": current_user.email,
        "roles": role_names,
        "active_role": active_role,
        "permissions": permission_names,
        "is_deleted": current_user.is_deleted,
        "must_change_password": current_user.must_change_password,
        "default_role": default_role_name,
        "company_id": company_id,
        "company_name": company_name,
        "active_company_id": active_company_id,
        "active_company_name": active_company_name,
        "active_company_country_code": active_company_country_code,
        "companies": companies_me,
        "photo_url": current_user.photo_url,
    }


@router.post("/logout")
def logout(
    request: Request,
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith(BEARER_PREFIX):
        raise HTTPException(status_code=400, detail="Missing or invalid Authorization header")

    token = auth_header.replace(BEARER_PREFIX, "")
    deactivate_all_sessions_for_user(db, current_user.id)
    revoke_token(token, db, RevokedTokens, user_id=current_user.id)

    log_user_action(
        db=db,
        executed_by=current_user.id,
        action="logout",
        table_name="user_sessions",
        table_id=None,
        before_data=None,
        after_data=None,
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    log_system_event(
        db=db,
        service_name="auth",
        action="user_logout",
        status="success",
        details={"user_id": str(current_user.id)},
        executed_by=current_user.email,
        ip_address=request.client.host if request.client else None,
    )

    return {"detail": "All sessions and tokens revoked successfully"}


@router.post("/set-default-role")
def set_default_role(
    request: Request,
    role: str = Body(..., embed=True),
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    roles = (
        db.query(Roles.name)
        .join(UserRoles, UserRoles.role_id == Roles.id)
        .filter(
            UserRoles.user_id == current_user.id,
            UserRoles.is_deleted.is_(False),
            Roles.is_deleted.is_(False),
        )
        .all()
    )
    role_names = [r.name for r in roles]
    if role not in role_names:
        raise HTTPException(status_code=400, detail="User does not have this role.")
    role_obj = db.query(Roles).filter(Roles.name == role, Roles.is_deleted.is_(False)).first()
    if not role_obj:
        raise HTTPException(status_code=400, detail="Role not found.")
    before = {"default_role": str(current_user.default_role) if current_user.default_role else None}
    current_user.default_role = role_obj.id
    db.commit()
    db.refresh(current_user)
    log_user_action(
        db=db,
        executed_by=current_user.id,
        action="set_default_role",
        table_name="users",
        table_id=current_user.id,
        before_data=before,
        after_data={"default_role": str(role_obj.id), "role_name": role},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    log_system_event(
        db=db,
        service_name="auth",
        action="set_default_role",
        status="success",
        details={"user_id": str(current_user.id), "role": role},
        executed_by=current_user.email,
        ip_address=request.client.host if request.client else None,
    )
    return {"detail": "Default role updated."}


@router.post("/set-default-company")
def set_default_company(
    request: Request,
    company_id: UUID = Body(..., embed=True),
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    if not user_has_membership(db, current_user.id, company_id):
        raise HTTPException(status_code=403, detail="You are not a member of this company.")
    co = (
        db.query(Companies)
        .filter(Companies.id == company_id, Companies.is_deleted.is_(False))
        .first()
    )
    if not co:
        raise HTTPException(status_code=400, detail="Company not found.")
    before = {"company_id": str(current_user.company_id) if current_user.company_id else None}
    current_user.company_id = company_id
    db.commit()
    db.refresh(current_user)
    log_user_action(
        db=db,
        executed_by=current_user.id,
        action="set_default_company",
        table_name="users",
        table_id=current_user.id,
        before_data=before,
        after_data={"company_id": str(company_id)},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    log_system_event(
        db=db,
        service_name="auth",
        action="set_default_company",
        status="success",
        details={"user_id": str(current_user.id), "company_id": str(company_id)},
        executed_by=current_user.email,
        ip_address=request.client.host if request.client else None,
    )
    return {"detail": "Default company updated."}


def get_active_role(
    token: Optional[str],
    user: Users,
    role_names: Optional[List[str]] = None,
    db: Optional[Session] = None,
):
    payload = None
    if token:
        payload = decode_token(
            token,
            secret_key=settings.secret_key,
            db=db,
            revoked_model=RevokedTokens,
        )
    active_role = payload.get("active_role") if payload else None
    if active_role:
        return active_role
    if user.default_role and db is not None:
        role_obj = (
            db.query(Roles).filter(Roles.id == user.default_role, Roles.is_deleted.is_(False)).first()
        )
        if role_obj:
            return role_obj.name
    if role_names and len(role_names) > 0:
        return role_names[0]
    return None
