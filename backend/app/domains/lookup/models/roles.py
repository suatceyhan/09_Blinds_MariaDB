from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text, UniqueConstraint, text
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.db_types import GUID


class Roles(Base):
    __tablename__ = "roles"

    id = Column(GUID(), primary_key=True, server_default=text("UUID()"))
    name = Column(String, nullable=False)
    description = Column(Text)
    is_protected = Column(Boolean, default=False, nullable=False)
    is_deleted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    created_by = Column(GUID(), ForeignKey("users.id"))
    updated_by = Column(GUID(), ForeignKey("users.id"))
    role_group_id = Column(GUID(), ForeignKey("role_groups.id"), nullable=True)

    role_group = relationship("RoleGroups", back_populates="roles")
    role_permissions = relationship("RolePermissions", back_populates="role")

    __table_args__ = (UniqueConstraint("name", name="uq_roles_name"),)
