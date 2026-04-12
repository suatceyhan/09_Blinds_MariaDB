from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Numeric, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class Companies(Base):
    __tablename__ = "companies"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    name = Column(String, nullable=False)
    phone = Column(String, nullable=True)
    website = Column(String, nullable=True)
    email = Column(String, nullable=True)
    address = Column(String(2000), nullable=True)
    maps_url = Column(String(2000), nullable=True)
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    logo_url = Column(String(500), nullable=True)
    tax_rate_percent = Column(Numeric(6, 3), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"), nullable=False)
    is_deleted = Column(Boolean, default=False, nullable=False)

    users = relationship("Users", back_populates="company", foreign_keys="Users.company_id")
    owner_user = relationship("Users", foreign_keys=[owner_user_id])
    user_memberships = relationship("UserCompanyMembership", back_populates="company")

    __table_args__ = (UniqueConstraint("name", name="uq_companies_name"),)
