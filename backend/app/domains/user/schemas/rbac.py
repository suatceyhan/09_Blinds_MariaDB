from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class UserRoleAssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    role_id: UUID
    created_at: datetime
    is_deleted: bool


class UserRoleAssignmentListOut(BaseModel):
    """Liste ekranı — kullanıcı e-postası ve rol adı ile."""

    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    role_id: UUID
    user_email: str
    role_name: str
    created_at: datetime
    is_deleted: bool


class UserRoleAssignmentCreate(BaseModel):
    user_id: UUID
    role_id: UUID
