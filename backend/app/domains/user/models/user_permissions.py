from sqlalchemy import Boolean, Column, DateTime, ForeignKey, UniqueConstraint, text
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.db_types import GUID


class UserPermissions(Base):
    __tablename__ = "user_permissions"

    user_id = Column(GUID(), ForeignKey("users.id"), primary_key=True)
    permission_id = Column(GUID(), ForeignKey("permissions.id"), primary_key=True)
    role_id = Column(GUID(), ForeignKey("roles.id"), primary_key=True)
    is_granted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    created_by = Column(GUID(), ForeignKey("users.id"))
    updated_by = Column(GUID(), ForeignKey("users.id"))
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
