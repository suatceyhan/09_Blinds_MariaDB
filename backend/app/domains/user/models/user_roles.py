from sqlalchemy import Boolean, Column, DateTime, ForeignKey, UniqueConstraint, text
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.db_types import GUID


class UserRoles(Base):
    __tablename__ = "user_roles"

    id = Column(GUID(), primary_key=True, server_default=text("UUID()"))
    user_id = Column(GUID(), ForeignKey("users.id"))
    role_id = Column(GUID(), ForeignKey("roles.id"))
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    created_by = Column(GUID(), ForeignKey("users.id"))
    updated_by = Column(GUID(), ForeignKey("users.id"))
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    is_deleted = Column(Boolean, default=False)

    user = relationship("Users", foreign_keys=[user_id], back_populates="user_roles")
    role = relationship("Roles", backref="user_roles")

    __table_args__ = (UniqueConstraint("user_id", "role_id", name="uq_user_roles_user_role"),)
