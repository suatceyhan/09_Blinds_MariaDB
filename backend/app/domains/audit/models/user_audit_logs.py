from sqlalchemy import Column, DateTime, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.core.database import Base


class UserAuditLogs(Base):
    __tablename__ = "user_audit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    executed_by = Column(UUID(as_uuid=True), nullable=True)
    action = Column(String(50), nullable=False)
    table_name = Column(String(100), nullable=False)
    table_id = Column(UUID(as_uuid=True))
    before_data = Column(JSONB)
    after_data = Column(JSONB)
    ip_address = Column(String(45))
    user_agent = Column(String)
    timestamp = Column(DateTime(timezone=True), server_default=text("NOW()"), nullable=False)

    __table_args__ = (
        UniqueConstraint(
            "executed_by",
            "action",
            "table_name",
            "timestamp",
            name="uq_user_audit_user_action_table_time",
        ),
    )
