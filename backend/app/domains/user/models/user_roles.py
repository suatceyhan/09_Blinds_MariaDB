from sqlalchemy import Boolean, Column, DateTime, ForeignKey, UniqueConstraint, text
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.sqlalchemy_types import MariaUuid


class UserRoles(Base):
    __tablename__ = "user_roles"

    id = Column(MariaUuid(), primary_key=True, server_default=text("(UUID())"))
    user_id = Column(MariaUuid(), ForeignKey("users.id"))
    role_id = Column(MariaUuid(), ForeignKey("roles.id"))
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    created_by = Column(MariaUuid(), ForeignKey("users.id"))
    updated_by = Column(MariaUuid(), ForeignKey("users.id"))
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    is_deleted = Column(Boolean, default=False)

    user = relationship("Users", foreign_keys=[user_id], back_populates="user_roles")
    role = relationship("Roles", backref="user_roles")

    __table_args__ = (UniqueConstraint("user_id", "role_id", name="uq_user_roles_user_role"),)
