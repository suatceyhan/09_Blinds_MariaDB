from sqlalchemy import JSON, Column, DateTime, String, UniqueConstraint, text

from app.core.database import Base
from app.core.db_types import GUID


class UserAuditLogs(Base):
    __tablename__ = "user_audit_logs"

    id = Column(GUID(), primary_key=True, server_default=text("UUID()"))
    executed_by = Column(GUID(), nullable=True)
    action = Column(String(50), nullable=False)
    table_name = Column(String(100), nullable=False)
    table_id = Column(GUID())
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
