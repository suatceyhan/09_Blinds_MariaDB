from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PermissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    key: str
    parent_key: Optional[str] = None
    name: str
    target_type: str
    target_id: str
    action: str
    module_name: Optional[str] = None
    route_path: Optional[str] = None
    lookup_key: Optional[str] = None
    sort_index: int
    is_deleted: bool
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    created_by: Optional[UUID] = None
    updated_by: Optional[UUID] = None


class PermissionCreate(BaseModel):
    key: str = Field(..., min_length=1, max_length=200)
    name: str = Field(..., min_length=1, max_length=500)
    parent_key: Optional[str] = None
    target_type: str = Field(default="module", max_length=100)
    target_id: str = Field(default="global", max_length=200)
    action: str = Field(default="access", max_length=100)
    module_name: Optional[str] = None
    route_path: Optional[str] = None
    lookup_key: Optional[str] = None
    sort_index: int = 0
