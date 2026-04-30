from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.logger import log_system_event, log_user_action
from app.dependencies.auth import require_superadmin
from app.domains.user.crud import role_permissions_admin as rp_admin
from app.domains.user.schemas.role_permissions_admin import RolePermissionGrantsOut, RolePermissionGrantsSet
from app.domains.user.models.users import Users

router = APIRouter(prefix="/role-permission-grants", tags=["Role permission grants"])


@router.get("/by-role/{role_id}", response_model=RolePermissionGrantsOut)
def get_grants_for_role(
    role_id: UUID,
    db: Session = Depends(get_db),
    _: Users = Depends(require_superadmin),
):
    ids = rp_admin.list_granted_permission_ids(db, role_id)
    return RolePermissionGrantsOut(role_id=role_id, permission_ids=ids)


@router.put("/by-role/{role_id}", response_model=RolePermissionGrantsOut)
def set_grants_for_role(
    role_id: UUID,
    body: RolePermissionGrantsSet,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Users = Depends(require_superadmin),
):
    before_ids = rp_admin.list_granted_permission_ids(db, role_id)
    try:
        after_ids = rp_admin.sync_role_grants(
            db,
            role_id=role_id,
            permission_ids=body.permission_ids,
            actor_id=current_user.id,
        )
    except ValueError as e:
        code = str(e)
        if code == "role_not_found":
            raise HTTPException(status_code=404, detail="Role not found.") from e
        if code == "invalid_permission":
            raise HTTPException(status_code=400, detail="Invalid or deleted permission id.") from e
        raise
    log_user_action(
        db=db,
        executed_by=current_user.id,
        action="update",
        table_name="role_permissions",
        table_id=role_id,
        before_data={"permission_ids": [str(x) for x in before_ids]},
        after_data={"permission_ids": [str(x) for x in after_ids]},
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    log_system_event(
        db=db,
        service_name="lookup",
        action="sync_role_permissions",
        status="success",
        details={"role_id": str(role_id), "count": len(after_ids)},
        executed_by=current_user.email,
        ip_address=request.client.host if request.client else None,
    )
    return RolePermissionGrantsOut(role_id=role_id, permission_ids=after_ids)


@router.get("/matrix/{role_id}")
def get_role_permission_matrix(
    role_id: UUID,
    db: Session = Depends(get_db),
    _: Users = Depends(require_superadmin),
):
    """DWP: { permission_id: is_granted }."""
    return rp_admin.get_permission_matrix_for_role(db, role_id)


@router.put("/matrix/{role_id}")
def put_role_permission_matrix(
    role_id: UUID,
    body: dict[str, Any],
    request: Request,
    db: Session = Depends(get_db),
    current_user: Users = Depends(require_superadmin),
):
    # `apply_role_permission_matrix` commits; capture primitives before ORM instance expires.
    actor_id = current_user.id
    actor_email = current_user.email

    normalized: dict[str, bool] = {}
    for k, v in body.items():
        if isinstance(v, dict):
            normalized[k] = bool(v.get("is_granted", False))
        else:
            normalized[k] = bool(v)
    try:
        rp_admin.apply_role_permission_matrix(
            db,
            role_id=role_id,
            updates=normalized,
            actor_id=actor_id,
        )
    except ValueError as e:
        if str(e) == "role_not_found":
            raise HTTPException(status_code=404, detail="Role not found.") from e
        raise
    log_system_event(
        db=db,
        service_name="lookup",
        action="put_role_permission_matrix",
        status="success",
        details={"role_id": str(role_id), "n": len(normalized)},
        executed_by=actor_email,
        ip_address=request.client.host if request.client else None,
    )
    return {"status": "success"}
