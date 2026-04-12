import json
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.authorization import get_user_permissions
from app.core.database import get_db
from app.core.tenant_rls import refresh_tenant_rls_context
from app.core.logger import log_system_event
from app.core.security import create_access_token
from app.dependencies.auth import get_current_user
from app.domains.user.models.users import Users
from app.domains.user.services.company_membership import user_has_membership

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.post("/switch-company")
async def switch_company(
    request: Request,
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    try:
        content_type = request.headers.get("content-type", "").lower()
        company_id: UUID | None = None
        if "application/json" in content_type:
            data = await request.json()
            if isinstance(data, dict) and data.get("company_id"):
                company_id = UUID(str(data["company_id"]))
        else:
            body = (await request.body()).decode("utf-8").strip()
            if body.startswith("{"):
                obj = json.loads(body)
                if isinstance(obj, dict) and obj.get("company_id"):
                    company_id = UUID(str(obj["company_id"]))
        if not company_id:
            raise HTTPException(status_code=400, detail="company_id is required")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid body: {e!s}") from e

    if not user_has_membership(db, current_user.id, company_id):
        raise HTTPException(status_code=403, detail="You are not a member of this company.")

    refresh_tenant_rls_context(
        db, current_user, company_id, active_role=getattr(current_user, "active_role", None)
    )

    canonical_role = getattr(current_user, "active_role", None) or (
        current_user.roles[0] if current_user.roles else None
    )
    user_owned_roles = set(current_user.roles or [])
    permissions = get_user_permissions(db, current_user.id, canonical_role)
    new_access_token = create_access_token(
        data={
            "user_id": str(current_user.id),
            "email": current_user.email,
            "roles": list(user_owned_roles),
            "active_role": canonical_role,
            "must_change_password": getattr(current_user, "must_change_password", False),
            "permissions": permissions,
            "active_company_id": str(company_id),
        }
    )

    log_system_event(
        db=db,
        service_name="auth",
        action="switch_company",
        status="success",
        details={"user_id": str(current_user.id), "company_id": str(company_id)},
        executed_by=current_user.email,
        ip_address=request.client.host if request.client else None,
    )

    return {"access_token": new_access_token, "token_type": "bearer"}
