from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.core.authorization import is_effective_superadmin
from app.core.database import get_db
from app.core.system_roles import is_reserved_system_role_name
from app.core.logger import log_system_event, log_user_action
from app.dependencies.auth import get_current_user, require_superadmin
from app.domains.lookup.crud import roles as roles_crud
from app.domains.lookup.schemas.roles import RoleCreate, RoleOut, RoleUpdate
from app.domains.user.models.users import Users

router = APIRouter(prefix="/roles", tags=["Roles"])


@router.get("", response_model=list[RoleOut])
def list_roles(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    name: str | None = Query(None),
    include_deleted: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    ar = getattr(current_user, "active_role", None)
    if include_deleted and not is_effective_superadmin(db, current_user.id, ar):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Including deleted roles is not allowed.",
        )
    return roles_crud.list_roles(
        db,
        actor_user_id=current_user.id,
        active_role=ar,
        skip=skip,
        limit=limit,
        name=name,
        include_deleted=include_deleted,
    )


@router.get("/{role_id}", response_model=RoleOut)
def get_role(
    role_id: UUID,
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    row = roles_crud.get_role(db, role_id)
    if not row or row.is_deleted:
        raise HTTPException(status_code=404, detail="Role not found.")
    if (
        not is_effective_superadmin(
            db, current_user.id, getattr(current_user, "active_role", None)
        )
        and row.name.lower() == "superadmin"
    ):
        raise HTTPException(status_code=404, detail="Role not found.")
    return row


@router.post("", response_model=RoleOut)
def create_role(
    body: RoleCreate,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    current_user: Users = Depends(require_superadmin),
):
    from app.domains.lookup.models.roles import Roles

    exists = (
        db.query(Roles)
        .filter(Roles.name == body.name.strip(), Roles.is_deleted.is_(False))
        .first()
    )
    if exists:
        raise HTTPException(status_code=409, detail="A role with this name already exists.")
    if is_reserved_system_role_name(body.name):
        raise HTTPException(
            status_code=400,
            detail="This role name is reserved for the system (superadmin, admin, user).",
        )
    created, reactivated, before_snap = roles_crud.create_role(
        db, body, created_by=current_user.id
    )
    log_user_action(
        db=db,
        executed_by=current_user.id,
        action="update" if reactivated else "create",
        table_name="roles",
        table_id=created.id,
        before_data=before_snap if reactivated else None,
        after_data=jsonable_encoder(created),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    log_system_event(
        db=db,
        service_name="lookup",
        action="reactivate_role" if reactivated else "create_role",
        status="success",
        details={"role_id": str(created.id), "reactivated": reactivated},
        executed_by=current_user.email,
        ip_address=request.client.host if request.client else None,
    )
    response.status_code = status.HTTP_200_OK if reactivated else status.HTTP_201_CREATED
    return created


@router.patch("/{role_id}", response_model=RoleOut)
def update_role(
    role_id: UUID,
    body: RoleUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Users = Depends(require_superadmin),
):
    row = roles_crud.get_role(db, role_id)
    if not row:
        raise HTTPException(status_code=404, detail="Role not found.")
    if is_reserved_system_role_name(row.name):
        raise HTTPException(status_code=403, detail="System roles cannot be modified.")
    if body.name is not None and is_reserved_system_role_name(body.name):
        raise HTTPException(status_code=400, detail="This role name is reserved for the system.")
    if row.is_protected and body.is_deleted is True:
        raise HTTPException(status_code=400, detail="Protected roles cannot be deleted.")
    before = jsonable_encoder(row)
    updated = roles_crud.update_role(db, role_id, body, updated_by=current_user.id)
    if not updated:
        raise HTTPException(status_code=404, detail="Role not found.")
    log_user_action(
        db=db,
        executed_by=current_user.id,
        action="update",
        table_name="roles",
        table_id=role_id,
        before_data=before,
        after_data=jsonable_encoder(updated),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    log_system_event(
        db=db,
        service_name="lookup",
        action="update_role",
        status="success",
        details={"role_id": str(role_id)},
        executed_by=current_user.email,
        ip_address=request.client.host if request.client else None,
    )
    return updated


@router.delete("/{role_id}", response_model=RoleOut)
def delete_role(
    role_id: UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Users = Depends(require_superadmin),
):
    row = roles_crud.get_role(db, role_id)
    if not row:
        raise HTTPException(status_code=404, detail="Role not found.")
    if is_reserved_system_role_name(row.name):
        raise HTTPException(status_code=403, detail="System roles cannot be deleted.")
    before = jsonable_encoder(row)
    deleted = roles_crud.soft_delete_role(db, role_id, updated_by=current_user.id)
    if not deleted:
        raise HTTPException(status_code=400, detail="Role could not be deleted (may be protected).")
    log_user_action(
        db=db,
        executed_by=current_user.id,
        action="soft_delete",
        table_name="roles",
        table_id=role_id,
        before_data=before,
        after_data=jsonable_encoder(deleted),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    log_system_event(
        db=db,
        service_name="lookup",
        action="delete_role",
        status="success",
        details={"role_id": str(role_id)},
        executed_by=current_user.email,
        ip_address=request.client.host if request.client else None,
    )
    return deleted
