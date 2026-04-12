from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class LoginAttempts(Base):
    __tablename__ = "login_attempts"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    ip_address = Column(String(45))
    user_agent = Column(String)
    success = Column(Boolean, default=False)
    attempted_at = Column(DateTime(timezone=True), server_default=text("CURRENT_TIMESTAMP"))

    user = relationship("Users", back_populates="login_attempts")

    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "ip_address",
            "attempted_at",
            name="uq_login_attempts_user_ip_time",
        ),
    )
