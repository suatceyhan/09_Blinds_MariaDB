from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class SystemAuditLogOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    service_name: str
    action: str
    status: str
    details: Optional[dict[str, Any]] = None
    executed_by: Optional[str] = None
    ip_address: Optional[str] = None
    timestamp: datetime
