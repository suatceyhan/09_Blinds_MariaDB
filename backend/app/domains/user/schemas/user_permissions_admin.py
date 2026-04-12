from uuid import UUID

from pydantic import BaseModel, Field


class UserPermissionBulkBody(BaseModel):
    user_id: UUID
    role_id: UUID
    permissions: dict[str, bool] = Field(default_factory=dict)
