from sqlalchemy import Boolean, Column, DateTime, ForeignKey, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class UserPermissions(Base):
    __tablename__ = "user_permissions"

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    permission_id = Column(UUID(as_uuid=True), ForeignKey("permissions.id"), primary_key=True)
    role_id = Column(UUID(as_uuid=True), ForeignKey("roles.id"), primary_key=True)
    is_granted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    updated_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    is_deleted = Column(Boolean, default=False)

    user = relationship("Users", foreign_keys=[user_id], back_populates="user_permissions")
    permission = relationship("Permissions")

    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "permission_id",
            "role_id",
            name="uq_user_permissions_user_permission_role",
        ),
    )
