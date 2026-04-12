from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator


class CompanyMembershipRef(BaseModel):
    """UserCompanyMembership üzerinden aktif şirket üyelikleri."""

    id: UUID
    name: str


class UserListItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    first_name: str
    last_name: str
    phone: str
    company_id: Optional[UUID] = None
    company_name: Optional[str] = None
    companies: List[CompanyMembershipRef] = Field(default_factory=list)
    is_deleted: bool = False
    roles: List[str] = Field(default_factory=list)


class UserCreateIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=256)
    first_name: str = Field(min_length=1, max_length=120)
    last_name: str = Field(min_length=1, max_length=120)
    phone: str = Field(min_length=5, max_length=32)
    default_role_name: Optional[str] = None
    company_id: Optional[UUID] = None


class AddCompanyMembershipIn(BaseModel):
    company_id: UUID


class UserUpdateIn(BaseModel):
    """Directory PATCH: tüm alanlar isteğe bağlı; en az biri dolu olmalı."""

    email: Optional[EmailStr] = None
    password: Optional[str] = Field(None, min_length=6, max_length=256)
    first_name: Optional[str] = Field(None, min_length=1, max_length=120)
    last_name: Optional[str] = Field(None, min_length=1, max_length=120)
    phone: Optional[str] = Field(None, min_length=5, max_length=32)
    default_role_name: Optional[str] = Field(None, max_length=120)

    @model_validator(mode="after")
    def at_least_one_field(self):
        if not self.model_dump(exclude_none=True):
            raise ValueError("At least one field must be provided.")
        return self
