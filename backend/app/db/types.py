"""SQLAlchemy helpers aligned with MariaDB (UUID via native UUID() default on MariaDB 10.7+)."""

from sqlalchemy import JSON, text

from app.core.sqlalchemy_types import MariaUuid


def uuid_default() -> text:
    return text("(UUID())")


__all__ = ["JSON", "MariaUuid", "uuid_default"]
