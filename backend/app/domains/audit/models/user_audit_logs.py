from sqlalchemy import Column, DateTime, String, UniqueConstraint, text
from sqlalchemy import JSON

from app.core.database import Base
from app.core.sqlalchemy_types import MariaUuid


class UserAuditLogs(Base):
    __tablename__ = "user_audit_logs"

    id = Column(MariaUuid(), primary_key=True, server_default=text("(UUID())"))
    executed_by = Column(MariaUuid(), nullable=True)
    action = Column(String(50), nullable=False)
    table_name = Column(String(100), nullable=False)
    table_id = Column(MariaUuid())
    before_data = Column(JSON)
    after_data = Column(JSON)
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
