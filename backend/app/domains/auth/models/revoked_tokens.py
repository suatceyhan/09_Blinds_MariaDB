from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class RevokedTokens(Base):
    __tablename__ = "revoked_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    token = Column(String, nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    revoked_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    is_used = Column(Boolean, default=False)

    user = relationship("Users", back_populates="revoked_tokens")

    __table_args__ = (UniqueConstraint("token", name="uq_revoked_tokens_token"),)
