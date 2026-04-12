from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.logger import log_system_event, log_user_action
from app.dependencies.auth import require_superadmin
from app.domains.lookup.models.roles import Roles
from app.domains.user.crud import user_permissions_admin as up_admin
from app.domains.user.schemas.user_permissions_admin import UserPermissionBulkBody
from app.domains.user.models.users import Users

router = APIRouter(prefix="/user-permission-grants", tags=["User permission grants"])


@router.get("/user-role-matrix")
def get_user_role_matrix(
    user_id: UUID = Query(...),
    role_id: UUID = Query(...),
    db: Session = Depends(get_db),
    _: Users = Depends(require_superadmin),
):
    if not db.query(Roles).filter(Roles.id == role_id, Roles.is_deleted.is_(False)).first():
        raise HTTPException(status_code=404, detail="Role not found.")
    return up_admin.get_user_role_permission_matrix_rows(db, user_id=user_id, role_id=role_id)


@router.post("/bulk-update")
def bulk_update_user_permissions(
    body: UserPermissionBulkBody,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Users = Depends(require_superadmin),
):
    up_admin.bulk_update_user_permissions_for_role(
        db,
        user_id=body.user_id,
        role_id=body.role_id,
        updates=body.permissions,
        acting_user_id=current_user.id,
    )
    log_user_action(
        db=db,
        executed_by=current_user.id,
        action="bulk_update",
        table_name="user_permissions",
        table_id=body.user_id,
        before_data=None,
        after_data={
            "role_id": str(body.role_id),
            "keys": list(body.permissions.keys()),
        },
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    log_system_event(
        db=db,
        service_name="user",
        action="bulk_update_user_permissions",
        status="success",
        details={"user_id": str(body.user_id), "role_id": str(body.role_id)},
        executed_by=current_user.email,
        ip_address=request.client.host if request.client else None,
    )
    return {"status": "success"}
