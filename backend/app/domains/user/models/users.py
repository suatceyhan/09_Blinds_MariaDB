from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, TIMESTAMP, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class Users(Base):
    """Cekirdek kullanici modeli (RBAC, oturum, sifre sıfırlama)."""

    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    first_name = Column(String, nullable=False)
    last_name = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    password = Column(String, nullable=False)
    email = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    updated_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    is_deleted = Column(Boolean, default=False)
    last_login = Column(TIMESTAMP)
    failed_login_attempts = Column(Integer, default=0)
    account_locked_until = Column(TIMESTAMP)
    is_password_set = Column(Boolean, default=False)
    is_first_login = Column(Boolean, default=True)
    must_change_password = Column(Boolean, default=False)

    role_group_id = Column(UUID(as_uuid=True), ForeignKey("role_groups.id"), nullable=True)
    role_group = relationship("RoleGroups", foreign_keys=[role_group_id])

    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=True)
    company = relationship("Companies", back_populates="users", foreign_keys=[company_id])
    company_memberships = relationship(
        "UserCompanyMembership",
        back_populates="user",
        foreign_keys="UserCompanyMembership.user_id",
    )

    default_role = Column(UUID(as_uuid=True), ForeignKey("roles.id"), nullable=True)
    photo_url = Column(String, nullable=True)

    user_roles = relationship("UserRoles", foreign_keys="UserRoles.user_id", back_populates="user")
    user_permissions = relationship(
        "UserPermissions", foreign_keys="UserPermissions.user_id", back_populates="user"
    )
    revoked_tokens = relationship("RevokedTokens", back_populates="user")
    user_sessions = relationship("UserSessions", back_populates="user")
    login_attempts = relationship("LoginAttempts", back_populates="user")
    password_reset_tokens = relationship("PasswordResetTokens", back_populates="user")

    __table_args__ = (
        UniqueConstraint("email", name="uq_users_email"),
        UniqueConstraint("phone", name="uq_users_phone"),
    )

    def __repr__(self):
        return f"<Users(id={self.id}, email={self.email})>"
