from sqlalchemy import Column, DateTime, String, UniqueConstraint, text
from sqlalchemy import JSON

from app.core.database import Base
from app.core.sqlalchemy_types import MariaUuid


class SystemAuditLogs(Base):
    __tablename__ = "system_audit_logs"

    id = Column(MariaUuid(), primary_key=True, server_default=text("(UUID())"))
    service_name = Column(String(100), nullable=False)
    action = Column(String(100), nullable=False)
    status = Column(String(20), nullable=False)
    details = Column(JSON)
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
