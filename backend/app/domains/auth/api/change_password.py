from fastapi import APIRouter, Depends, HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from app.core.authorization import has_permission
from app.core.config import settings
from app.core.database import get_db
from app.core.logger import log_system_event, log_user_action
from app.core.security import hash_password, verify_password
from app.dependencies.auth import get_current_user
from app.domains.auth.schemas.change_password import ChangePasswordRequest, ChangePasswordResponse
from app.domains.user.models.users import Users

router = APIRouter(prefix="/auth", tags=["Change Password"])


@router.post("/change_password", response_model=ChangePasswordResponse)
def change_password(
    data: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    pepper = settings.password_pepper
    active = getattr(current_user, "active_role", None)
    if not current_user.must_change_password and not has_permission(
        db, current_user.id, "account.password.edit", active_role=active
    ):
        raise HTTPException(
            status_code=403,
            detail="You are not allowed to change password (account.password.edit).",
        )

    if data.new_password != data.new_password_again:
        raise HTTPException(status_code=400, detail="New passwords do not match.")

    if not verify_password(data.current_password, current_user.password, pepper):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")

    if data.new_password == data.current_password:
        raise HTTPException(
            status_code=400,
            detail="New password must be different from the current password.",
        )

    before_data = jsonable_encoder(current_user)
    current_user.password = hash_password(data.new_password, pepper)

    if current_user.must_change_password:
        current_user.must_change_password = False

    db.commit()
    db.refresh(current_user)
    after_data = jsonable_encoder(current_user)

    log_user_action(
        db=db,
        executed_by=current_user.id,
        action="change_password",
        table_name="users",
        table_id=current_user.id,
        before_data=before_data,
        after_data=after_data,
    )
    log_system_event(
        db=db,
        service_name="auth",
        action="password_change",
        status="success",
        details={"user_id": str(current_user.id)},
        executed_by=current_user.email,
    )

    return {"msg": "Your password has been updated."}
