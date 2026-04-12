from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class Roles(Base):
    __tablename__ = "roles"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    name = Column(String, nullable=False)
    description = Column(Text)
    is_protected = Column(Boolean, default=False, nullable=False)
    is_deleted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    updated_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    role_group_id = Column(UUID(as_uuid=True), ForeignKey("role_groups.id"), nullable=True)

    role_group = relationship("RoleGroups", back_populates="roles")
    role_permissions = relationship("RolePermissions", back_populates="role")

    __table_args__ = (UniqueConstraint("name", name="uq_roles_name"),)
