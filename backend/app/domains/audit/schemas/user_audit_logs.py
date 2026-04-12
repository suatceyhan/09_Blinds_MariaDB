from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class UserAuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    executed_by: Optional[UUID] = None
    action: str
    table_name: str
    table_id: Optional[UUID] = None
    before_data: Optional[dict[str, Any]] = None
    after_data: Optional[dict[str, Any]] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    timestamp: datetime
