from __future__ import annotations

import uuid

from sqlalchemy.types import CHAR, TypeDecorator


class GUID(TypeDecorator):
    """DB-independent UUID type.

    MariaDB stores UUIDs as CHAR(36) but Python code keeps using uuid.UUID.
    """

    impl = CHAR(36)
    cache_ok = True

    def process_bind_param(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        if isinstance(value, uuid.UUID):
            return str(value)
        # Accept str/bytes/int/etc. if it can be parsed as UUID
        return str(uuid.UUID(str(value)))

    def process_result_value(self, value, dialect):  # type: ignore[override]
        if value is None:
            return None
        return uuid.UUID(str(value))

