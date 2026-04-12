from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class PasswordResetTokens(Base):
    __tablename__ = "password_reset_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
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
