from sqlalchemy import Column, DateTime, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core.database import Base


class SystemAuditLogs(Base):
    __tablename__ = "system_audit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    service_name = Column(String(100), nullable=False)
    action = Column(String(100), nullable=False)
    status = Column(String(20), nullable=False)
    details = Column(JSONB)
    executed_by = Column(String(100), nullable=True)
    ip_address = Column(String(45))
    timestamp = Column(DateTime(timezone=True), server_default=text("NOW()"), nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "service_name",
            "action",
            "timestamp",
            name="uq_system_audit_service_action_time",
        ),
    )
