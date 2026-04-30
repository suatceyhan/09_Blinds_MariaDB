from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text, text
from sqlalchemy.orm import relationship

from app.core.database import Base
from app.core.sqlalchemy_types import MariaUuid


class PendingEmployeeSelfRegistrations(Base):
    __tablename__ = "pending_employee_self_registrations"

    id = Column(MariaUuid(), primary_key=True, server_default=text("(UUID())"))
    first_name = Column(String, nullable=False)
    last_name = Column(String, nullable=False)
    email = Column(String, nullable=False)
    phone = Column(String, nullable=False)
    password = Column(String, nullable=False)
    role_group_id = Column(MariaUuid(), ForeignKey("role_groups.id"), nullable=True)
    request_note = Column(Text)
    verification_token = Column(String, nullable=False)
    token_sent_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    is_email_verified = Column(Boolean, default=False, nullable=False)
    email_verified_at = Column(DateTime(timezone=True))
    pending_status = Column(
        String(32),
        nullable=False,
        default="EMAIL_NOT_VERIFIED",
    )
    approved_by = Column(MariaUuid(), ForeignKey("users.id"))
    approved_at = Column(DateTime(timezone=True))
    requested_at = Column(DateTime(timezone=True), server_default=text("NOW()"))
    is_deleted = Column(Boolean, default=False, nullable=False)

    role_group = relationship("RoleGroups", foreign_keys=[role_group_id])
    approved_by_user = relationship("Users", foreign_keys=[approved_by])
