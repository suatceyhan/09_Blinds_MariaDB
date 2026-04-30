from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text, text
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.db_types import GUID


class PendingCompanySelfRegistrations(Base):
    __tablename__ = "pending_company_self_registrations"

    id = Column(GUID(), primary_key=True, server_default=text("UUID()"))
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
    approved_by = Column(GUID(), ForeignKey("users.id"))
    approved_at = Column(DateTime(timezone=True))
    requested_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    is_deleted = Column(Boolean, default=False, nullable=False)

    approved_by_user = relationship("Users", foreign_keys=[approved_by])
