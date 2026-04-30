from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, UniqueConstraint, text
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.db_types import GUID


class RevokedTokens(Base):
    __tablename__ = "revoked_tokens"

    id = Column(GUID(), primary_key=True, server_default=text("UUID()"))
    token = Column(String, nullable=False)
    user_id = Column(GUID(), ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    revoked_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    is_used = Column(Boolean, default=False)

    user = relationship("Users", back_populates="revoked_tokens")

    __table_args__ = (UniqueConstraint("token", name="uq_revoked_tokens_token"),)
