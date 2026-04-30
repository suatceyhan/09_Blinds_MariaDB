from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Numeric, String, UniqueConstraint, text
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.sqlalchemy_types import MariaUuid


class Companies(Base):
    __tablename__ = "companies"

    id = Column(MariaUuid(), primary_key=True, server_default=text("(UUID())"))
    name = Column(String, nullable=False)
    phone = Column(String, nullable=True)
    website = Column(String, nullable=True)
    email = Column(String, nullable=True)
    address = Column(String(2000), nullable=True)
    postal_code = Column(String(32), nullable=True)
    country_code = Column(String(2), nullable=True)
    region_code = Column(String(8), nullable=True)
    maps_url = Column(String(2000), nullable=True)
    owner_user_id = Column(MariaUuid(), ForeignKey("users.id"), nullable=True)
    logo_url = Column(String(500), nullable=True)
    tax_rate_percent = Column(Numeric(6, 3), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"), nullable=False)
    is_deleted = Column(Boolean, default=False, nullable=False)

    users = relationship("Users", back_populates="company", foreign_keys="Users.company_id")
    owner_user = relationship("Users", foreign_keys=[owner_user_id])
    user_memberships = relationship("UserCompanyMembership", back_populates="company")

    __table_args__ = (UniqueConstraint("name", name="uq_companies_name"),)
