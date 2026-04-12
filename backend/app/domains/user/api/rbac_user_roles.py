from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.logger import log_system_event, log_user_action
from app.dependencies.auth import require_superadmin
from app.domains.user.crud import rbac_assignments as rbac_crud
from app.domains.user.schemas.rbac import (
    UserRoleAssignmentCreate,
    UserRoleAssignmentListOut,
    UserRoleAssignmentOut,
)
from app.domains.user.models.users import Users

router = APIRouter(prefix="/user-roles", tags=["User roles"])


@router.get("", response_model=list[UserRoleAssignmentListOut])
def list_user_role_assignments(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    include_deleted: bool = Query(False),
    db: Session = Depends(get_db),
    _: Users = Depends(require_superadmin),
):
    rows = rbac_crud.list_assignments_with_labels(
        db, skip=skip, limit=limit, include_deleted=include_deleted
    )
    return [
        UserRoleAssignmentListOut(
            id=ur.id,
            user_id=ur.user_id,
            role_id=ur.role_id,
            user_email=email,
            role_name=role_name,
            created_at=ur.created_at,
            is_deleted=ur.is_deleted,
        )
        for ur, email, role_name in rows
    ]


@router.post("", response_model=UserRoleAssignmentOut)
def create_user_role_assignment(
    body: UserRoleAssignmentCreate,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    current_user: Users = Depends(require_superadmin),
):
    try:
        created, reactivated, before_snap = rbac_crud.assign_role(
            db,
            user_id=body.user_id,
            role_id=body.role_id,
            actor_id=current_user.id,
        )
    except ValueError as e:
        code = str(e)
        if code == "already_assigned":
            raise HTTPException(status_code=409, detail="This role is already assigned to the user.") from e
        raise HTTPException(status_code=404, detail="User or role not found.") from e
    log_user_action(
        db=db,
        executed_by=current_user.id,
        action="update" if reactivated else "create",
        table_name="user_roles",
        table_id=created.id,
        before_data=before_snap if reactivated else None,
        after_data=jsonable_encoder(created),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    log_system_event(
        db=db,
        service_name="user",
        action="reactivate_role" if reactivated else "assign_role",
        status="success",
        details={"user_role_id": str(created.id), "user_id": str(body.user_id), "role_id": str(body.role_id)},
        executed_by=current_user.email,
        ip_address=request.client.host if request.client else None,
    )
    response.status_code = status.HTTP_200_OK if reactivated else status.HTTP_201_CREATED
    return created


@router.delete("/{assignment_id}", response_model=UserRoleAssignmentOut)
def delete_user_role_assignment(
    assignment_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Users = Depends(require_superadmin),
):
    row = rbac_crud.get_assignment(db, assignment_id)
    if not row:
        raise HTTPException(status_code=404, detail="Assignment not found.")
    before = jsonable_encoder(row)
    deleted = rbac_crud.soft_delete_assignment(db, assignment_id, actor_id=current_user.id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Assignment not found.")
    log_user_action(
        db=db,
        executed_by=current_user.id,
        action="soft_delete",
        table_name="user_roles",
        table_id=assignment_id,
        before_data=before,
        after_data=jsonable_encoder(deleted),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    log_system_event(
        db=db,
        service_name="user",
        action="unassign_role",
        status="success",
        details={"user_role_id": str(assignment_id)},
        executed_by=current_user.email,
        ip_address=request.client.host if request.client else None,
    )
    return deleted
