from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint, text
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.sqlalchemy_types import MariaUuid


class PasswordResetTokens(Base):
    __tablename__ = "password_reset_tokens"

    id = Column(MariaUuid(), primary_key=True, server_default=text("(UUID())"))
    user_id = Column(MariaUuid(), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token = Column(String(100), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    expires_at = Column(DateTime(timezone=True), nullable=False)
    is_used = Column(Boolean, default=False)
    used_at = Column(DateTime(timezone=True))
    ip_address = Column(String(45))
    user_agent = Column(String)
    attempts = Column(Integer, default=0)

    user = relationship("Users", back_populates="password_reset_tokens")

    __table_args__ = (UniqueConstraint("token", name="uq_password_reset_tokens_token"),)
