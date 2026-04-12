from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.logger import log_system_event, log_user_action
from app.dependencies.auth import require_superadmin
from app.domains.lookup.crud import permissions as perm_crud
from app.domains.lookup.schemas.permissions import PermissionCreate, PermissionOut
from app.domains.user.models.users import Users

router = APIRouter(prefix="/permissions", tags=["Permissions"])


@router.get("", response_model=list[PermissionOut])
def list_permissions(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    name: str | None = Query(None),
    db: Session = Depends(get_db),
    _: Users = Depends(require_superadmin),
):
    return perm_crud.list_permissions(db, skip=skip, limit=limit, name=name)


@router.post("", response_model=PermissionOut, status_code=status.HTTP_201_CREATED)
def create_permission(
    body: PermissionCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: Users = Depends(require_superadmin),
):
    if perm_crud.get_permission_by_key(db, body.key):
        raise HTTPException(status_code=409, detail="A permission with this key already exists.")
    created = perm_crud.create_permission(db, body, created_by=current_user.id)
    log_user_action(
        db=db,
        executed_by=current_user.id,
        action="create",
        table_name="permissions",
        table_id=created.id,
        before_data=None,
        after_data=jsonable_encoder(created),
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    log_system_event(
        db=db,
        service_name="lookup",
        action="create_permission",
        status="success",
        details={"permission_id": str(created.id), "key": created.key},
        executed_by=current_user.email,
        ip_address=request.client.host if request.client else None,
    )
    return created


@router.get("/{permission_id}", response_model=PermissionOut)
def get_permission(
    permission_id: UUID,
    db: Session = Depends(get_db),
    _: Users = Depends(require_superadmin),
):
    row = perm_crud.get_permission(db, permission_id)
    if not row or row.is_deleted:
        raise HTTPException(status_code=404, detail="Permission not found.")
    return row
