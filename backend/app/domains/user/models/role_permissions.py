from sqlalchemy import Boolean, Column, DateTime, ForeignKey, UniqueConstraint, text
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.db_types import GUID


class RolePermissions(Base):
    __tablename__ = "role_permissions"

    role_id = Column(GUID(), ForeignKey("roles.id"), primary_key=True)
    permission_id = Column(GUID(), ForeignKey("permissions.id"), primary_key=True)
    is_granted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    created_by = Column(GUID(), ForeignKey("users.id"))
    updated_by = Column(GUID(), ForeignKey("users.id"))
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    is_deleted = Column(Boolean, default=False)

    role = relationship("Roles", foreign_keys=[role_id], back_populates="role_permissions")
    permission = relationship("Permissions")

    __table_args__ = (
        UniqueConstraint("role_id", "permission_id", name="uq_role_permissions_role_permission"),
    )
