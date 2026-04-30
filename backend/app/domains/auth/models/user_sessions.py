from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, TIMESTAMP, UniqueConstraint, text
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.db_types import GUID


class UserSessions(Base):
    __tablename__ = "user_sessions"

    id = Column(GUID(), primary_key=True, server_default=text("UUID()"))
    user_id = Column(GUID(), ForeignKey("users.id"))
    session_token = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    last_seen_at = Column(DateTime(timezone=True))
    expires_at = Column(TIMESTAMP)
    is_active = Column(Boolean, default=True)

    user = relationship("Users", back_populates="user_sessions")

    __table_args__ = (UniqueConstraint("session_token", name="uq_user_sessions_token"),)
