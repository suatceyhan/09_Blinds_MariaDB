from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, TIMESTAMP, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class UserSessions(Base):
    __tablename__ = "user_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    session_token = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    last_seen_at = Column(DateTime(timezone=True))
    expires_at = Column(TIMESTAMP)
    is_active = Column(Boolean, default=True)

    user = relationship("Users", back_populates="user_sessions")

    __table_args__ = (UniqueConstraint("session_token", name="uq_user_sessions_token"),)
