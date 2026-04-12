from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class CompanyRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str


class TokenResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    access_token: str
    refresh_token: Optional[str] = None
    token_type: str = "bearer"
    must_change_password: bool
    roles: list[str]
    default_role: Optional[UUID] = None
    active_role: Optional[str] = None


class UserResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: UUID
    first_name: str
    last_name: str
    phone: str
    email: EmailStr
    roles: list[str]
    permissions: list[str]
    is_deleted: Optional[bool] = None
    must_change_password: Optional[bool] = None
    default_role: Optional[str] = None
    active_role: Optional[str] = None
    company_id: Optional[UUID] = None
    company_name: Optional[str] = None
    active_company_id: Optional[UUID] = None
    active_company_name: Optional[str] = None
    companies: List[CompanyRef] = Field(default_factory=list)
    photo_url: Optional[str] = None


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=256)
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=5, max_length=32)
