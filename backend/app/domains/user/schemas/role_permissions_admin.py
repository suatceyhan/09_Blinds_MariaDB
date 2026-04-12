from uuid import UUID

from pydantic import BaseModel, Field


class RolePermissionGrantsOut(BaseModel):
    role_id: UUID
    permission_ids: list[UUID]


class RolePermissionGrantsSet(BaseModel):
    permission_ids: list[UUID] = Field(default_factory=list)
