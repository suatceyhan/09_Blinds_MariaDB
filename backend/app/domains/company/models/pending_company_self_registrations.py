from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.core.database import Base


class PendingCompanySelfRegistrations(Base):
    __tablename__ = "pending_company_self_registrations"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    first_name = Column(String, nullable=False)
    last_name = Column(String, nullable=False)
    email = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    password = Column(String, nullable=False)
    company_name = Column(String, nullable=False)
    company_phone = Column(String, nullable=True)
    website = Column(String, nullable=True)
    request_note = Column(Text)
    verification_token = Column(String, nullable=False)
    token_sent_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    is_email_verified = Column(Boolean, default=False, nullable=False)
    email_verified_at = Column(DateTime(timezone=True))
    pending_status = Column(String(32), nullable=False, default="EMAIL_NOT_VERIFIED")
    approved_by = Column(UUID(as_uuid=True), ForeignKey("users.id"))
    approved_at = Column(DateTime(timezone=True))
    requested_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    is_deleted = Column(Boolean, default=False, nullable=False)

    approved_by_user = relationship("Users", foreign_keys=[approved_by])
