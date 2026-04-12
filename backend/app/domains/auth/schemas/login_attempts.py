from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel


class LoginAttemptCreate(BaseModel):
    user_id: Optional[UUID] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    success: bool
