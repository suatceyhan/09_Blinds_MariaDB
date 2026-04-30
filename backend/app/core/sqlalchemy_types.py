"""UUID columns aligned with MariaDB ``CHAR(36)`` dashed RFC strings.

Stock SQLAlchemy ``Uuid`` compiles to MySQL/MariaDB ``CHAR(32)`` (hex without dashes).
This project's schema uses ``CHAR(36) DEFAULT (UUID())`` (dashed strings). Binding hex FK
values against dashed PK values breaks foreign-key checks even when the logical UUID matches.
"""

from __future__ import annotations

import uuid
from typing import Any, Optional

from sqlalchemy import CHAR
from sqlalchemy.types import TypeDecorator


class MariaUuid(TypeDecorator):
    """Maps ``uuid.UUID`` to dashed ``CHAR(36)`` for MariaDB/MySQL."""

    impl = CHAR
    cache_ok = True

    def __init__(self) -> None:
        super().__init__(36)

    @staticmethod
    def _normalize_bind(value: Any) -> uuid.UUID:
        if isinstance(value, uuid.UUID):
            return value
        if isinstance(value, str):
            s = value.strip()
            if len(s) == 32 and all(c in "0123456789abcdefABCDEF" for c in s):
                return uuid.UUID(hex=s)
            return uuid.UUID(s)
        return uuid.UUID(str(value))

    def process_bind_param(self, value: Any, dialect: Any) -> Optional[str]:
        if value is None:
            return None
        return str(self._normalize_bind(value))

    def process_result_value(self, value: Any, dialect: Any) -> Optional[uuid.UUID]:
        if value is None:
            return None
        if isinstance(value, uuid.UUID):
            return value
        s = str(value).strip()
        if len(s) == 32 and all(c in "0123456789abcdefABCDEF" for c in s):
            return uuid.UUID(hex=s)
        return uuid.UUID(s)
