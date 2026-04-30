from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, TIMESTAMP, UniqueConstraint, text

from app.core.database import Base
from app.core.db_types import GUID


class Permissions(Base):
    __tablename__ = "permissions"

    id = Column(GUID(), primary_key=True, server_default=text("UUID()"))
    key = Column(String, nullable=False)
    parent_key = Column(String, nullable=True)
    name = Column(String, nullable=False)
    target_type = Column(String, nullable=False)
    target_id = Column(String, nullable=False)
    action = Column(String, nullable=False)
    module_name = Column(String, nullable=True)
    route_path = Column(String)
    lookup_key = Column(String)
    sort_index = Column(Integer, nullable=False, server_default=text("0"))
    is_deleted = Column(Boolean, nullable=False, server_default=text("FALSE"))
    created_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=text("NOW()"))
    updated_at = Column(TIMESTAMP(timezone=True), nullable=False, server_default=text("NOW()"))
    created_by = Column(GUID(), ForeignKey("users.id"))
    updated_by = Column(GUID(), ForeignKey("users.id"))

    __table_args__ = (UniqueConstraint("key", name="uq_permissions_key"),)
