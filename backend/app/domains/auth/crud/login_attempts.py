from typing import Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session


def _users_pk_string_for_fk(db: Session, user_id: UUID) -> Optional[str]:
    """Resolve ``users.id`` to the exact stored CHAR text (hex vs dashed) for FK inserts."""
    dashed = str(user_id)
    hex32 = user_id.hex
    for candidate in (dashed, hex32):
        row = db.execute(
            text("SELECT id FROM users WHERE id = :x LIMIT 1"),
            {"x": candidate},
        ).first()
        if row:
            return row[0]
    return None


def log_login_attempt(
    db: Session,
    user_id: Optional[UUID],
    ip_address: Optional[str],
    user_agent: Optional[str],
    success: bool,
) -> None:
    """Persist a login attempt using DB-native id strings so FK matches ``users.id`` storage."""
    raw_uid: Optional[str] = None
    if user_id is not None:
        raw_uid = _users_pk_string_for_fk(db, user_id)

    db.execute(
        text(
            "INSERT INTO login_attempts (user_id, ip_address, user_agent, success) "
            "VALUES (:uid, :ip, :ua, :ok)"
        ),
        {"uid": raw_uid, "ip": ip_address, "ua": user_agent, "ok": success},
    )
    db.commit()
