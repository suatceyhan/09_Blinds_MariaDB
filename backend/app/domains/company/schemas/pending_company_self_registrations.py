from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class PendingCompanySelfRegistrationCreate(BaseModel):
    first_name: str = Field(..., min_length=1, max_length=200)
    last_name: str = Field(..., min_length=1, max_length=200)
    email: EmailStr
    phone: str = Field(..., min_length=1, max_length=32)
    password: str = Field(..., min_length=8, max_length=128)
    company_name: str = Field(..., min_length=1, max_length=300)
    company_phone: Optional[str] = Field(None, max_length=64)
    website: Optional[str] = Field(None, max_length=500)
    request_note: Optional[str] = Field(None, max_length=2000)


class PendingCompanySelfRegistrationCreated(BaseModel):
    id: UUID
    email: str
    message: str = "Your application was received. Verify your email using the link we sent."


class PendingCompanySelfRegistrationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    first_name: str
    last_name: str
    email: str
    phone: str
    company_name: str
    company_phone: Optional[str] = None
    website: Optional[str] = None
    request_note: Optional[str] = None
    is_email_verified: bool
    email_verified_at: Optional[datetime] = None
    pending_status: str
    approved_by: Optional[UUID] = None
    approved_at: Optional[datetime] = None
    requested_at: datetime
    is_deleted: bool


class PendingCompanyDenyBody(BaseModel):
    note: Optional[str] = Field(None, max_length=1000)
