from sqlalchemy import Boolean, Column, DateTime, ForeignKey, UniqueConstraint, text
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.sqlalchemy_types import MariaUuid


class UserCompanyMembership(Base):
    __tablename__ = "user_company_memberships"

    id = Column(MariaUuid(), primary_key=True, server_default=text("(UUID())"))
    user_id = Column(MariaUuid(), ForeignKey("users.id"), nullable=False)
    company_id = Column(MariaUuid(), ForeignKey("companies.id"), nullable=False)
    is_deleted = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))

    user = relationship("Users", back_populates="company_memberships")
    company = relationship("Companies", back_populates="user_memberships")

    __table_args__ = (
        UniqueConstraint("user_id", "company_id", name="uq_user_company_memberships_user_company"),
    )
