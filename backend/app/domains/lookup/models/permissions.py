from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, TIMESTAMP, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID

from app.core.database import Base


class Permissions(Base):
    __tablename__ = "permissions"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    key = Column(String, nullable=False)
    parent_key = Column(String, nullable=True)
    name = Column(String, nullable=False)
    target_type = Column(String, nullable=False)
    target_id = Column(String, nullable=False)
    action = Column(String, nullable=False)
    module_name = Column(String, nullable=True)
    route_path = Column(String)
    lookup_key = Column(String)
    sort_index = Column(Integer, default=0)
    is_deleted = Column(Boolean, default=False)
    created_at = Column(TIMESTAMP(timezone=True))
    updated_at = Column(TIMESTAMP(timezone=True))
    created_by = Column(UUID, ForeignKey("users.id"))
    updated_by = Column(UUID, ForeignKey("users.id"))

    __table_args__ = (UniqueConstraint("key", name="uq_permissions_key"),)
