from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class UserSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: Optional[UUID] = None
    session_token: str
    created_at: datetime
    last_seen_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    is_active: bool


class UserSessionCreate(BaseModel):
    user_id: Optional[UUID] = None
    session_token: str
    last_seen_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None


class UserSessionUpdate(BaseModel):
    user_id: Optional[UUID] = None
    session_token: Optional[str] = None
    created_at: Optional[datetime] = None
    last_seen_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    is_active: Optional[bool] = None
