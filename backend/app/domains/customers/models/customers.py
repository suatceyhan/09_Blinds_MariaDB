from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text, text

from app.core.database import Base
from app.core.db_types import GUID


class Customers(Base):
    __tablename__ = "customers"

    company_id = Column(
        GUID(),
        ForeignKey("companies.id", onupdate="CASCADE", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
    )
    id = Column(String(16), primary_key=True, nullable=False)

    name = Column(Text, nullable=False)
    surname = Column(Text, nullable=True)
    phone = Column(Text, nullable=True)
    email = Column(Text, nullable=True)
    address = Column(Text, nullable=True)
    postal_code = Column(Text, nullable=True)
    status_user_id = Column(String(16), nullable=True)

    active = Column(Boolean, nullable=False, server_default=text("TRUE"))
    created_at = Column(DateTime(timezone=True), server_default=text("NOW()"), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=text("NOW()"), nullable=False)

