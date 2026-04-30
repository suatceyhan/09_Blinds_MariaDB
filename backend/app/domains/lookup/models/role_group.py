from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text, UniqueConstraint, text
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.sqlalchemy_types import MariaUuid


class RoleGroups(Base):
    __tablename__ = "role_groups"

    id = Column(MariaUuid(), primary_key=True, server_default=text("(UUID())"))
    name = Column(String, nullable=False)
    description = Column(Text)
    is_deleted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    created_by = Column(MariaUuid(), ForeignKey("users.id"), nullable=True)
    updated_by = Column(MariaUuid(), ForeignKey("users.id"), nullable=True)

    roles = relationship("Roles", back_populates="role_group")

    __table_args__ = (UniqueConstraint("name", name="uq_role_groups_name"),)
