import json

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.authorization import get_user_permissions, resolve_role_by_active_name
from app.core.database import get_db
from app.core.logger import log_system_event
from app.core.security import create_access_token
from app.dependencies.auth import effective_company_id, get_current_user
from app.domains.user.models.user_roles import UserRoles
from app.domains.user.models.users import Users

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.post("/switch-role")
async def switch_role(
    request: Request,
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    """
    Aktif rolü yalnızca token içinde değiştirir (DB default_role aynı kalır).
    """
    try:
        content_type = request.headers.get("content-type", "").lower()
        role: str | None = None
        if "application/json" in content_type:
            data = await request.json()
            if isinstance(data, dict):
                role = data.get("role")
            elif isinstance(data, str):
                role = data
        else:
            body = (await request.body()).decode("utf-8").strip()
            if body.startswith("{"):
                try:
                    obj = json.loads(body)
                    role = obj.get("role") if isinstance(obj, dict) else (
                        obj if isinstance(obj, str) else None
                    )
                except Exception:
                    role = None
            else:
                role = body.strip('"')

        if not role:
            raise HTTPException(status_code=400, detail="role is required")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid role payload: {str(e)}") from e

    role_row = resolve_role_by_active_name(db, role)
    if not role_row:
        raise HTTPException(status_code=400, detail="Invalid role name.")

    assigned = (
        db.query(UserRoles)
        .filter(
            UserRoles.user_id == current_user.id,
            UserRoles.role_id == role_row.id,
            UserRoles.is_deleted.is_(False),
        )
        .first()
    )
    if not assigned:
        raise HTTPException(
            status_code=403,
            detail=f"User does not have role '{role_row.name}'.",
        )

    canonical = role_row.name
    user_owned_roles = set(current_user.roles or [])
    permissions = get_user_permissions(db, current_user.id, canonical)
    ec = effective_company_id(current_user)
    new_access_token = create_access_token(
        data={
            "user_id": str(current_user.id),
            "email": current_user.email,
            "roles": list(user_owned_roles),
            "active_role": canonical,
            "must_change_password": getattr(current_user, "must_change_password", False),
            "permissions": permissions,
            "active_company_id": str(ec) if ec else None,
        }
    )

    log_system_event(
        db=db,
        service_name="auth",
        action="switch_role",
        status="success",
        details={"user_id": str(current_user.id), "role": role},
        executed_by=current_user.email,
        ip_address=request.client.host if request.client else None,
    )

    return {"access_token": new_access_token, "token_type": "bearer"}
