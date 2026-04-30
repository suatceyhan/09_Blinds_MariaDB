from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from uuid import UUID

from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

SECRET_KEY = settings.secret_key
ALGORITHM = settings.algorithm
ACCESS_TOKEN_EXPIRE_SECONDS = settings.access_token_expire_minutes * 60
REFRESH_TOKEN_EXPIRE_SECONDS = settings.refresh_token_expire_minutes * 60


def hash_password(password: str, pepper: str = "") -> str:
    return pwd_context.hash(password + pepper)


def verify_password(plain_password: str, hashed_password: str, pepper: str = "") -> bool:
    try:
        return pwd_context.verify(plain_password + pepper, hashed_password)
    except Exception:
        return False


def deep_convert_uuid_to_str(obj: Any) -> Any:
    if isinstance(obj, UUID):
        return str(obj)
    if isinstance(obj, dict):
        return {k: deep_convert_uuid_to_str(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [deep_convert_uuid_to_str(i) for i in obj]
    return obj


def create_access_token(
    data: Dict[str, Any],
    secret_key: str = SECRET_KEY,
    expires_delta: Optional[int] = ACCESS_TOKEN_EXPIRE_SECONDS,
    algorithm: str = ALGORITHM,
) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(seconds=expires_delta or ACCESS_TOKEN_EXPIRE_SECONDS)
    to_encode = deep_convert_uuid_to_str(data.copy())
    to_encode.update({"exp": int(expire.timestamp()), "iat": int(now.timestamp())})
    return jwt.encode(to_encode, secret_key, algorithm=algorithm)


def create_refresh_token(
    data: Dict[str, Any],
    secret_key: str = SECRET_KEY,
    expires_delta: Optional[int] = REFRESH_TOKEN_EXPIRE_SECONDS,
    algorithm: str = ALGORITHM,
) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        seconds=expires_delta or REFRESH_TOKEN_EXPIRE_SECONDS
    )
    to_encode = deep_convert_uuid_to_str(data.copy())
    to_encode.update({"exp": int(expire.timestamp())})
    return jwt.encode(to_encode, secret_key, algorithm=algorithm)


def deep_convert_str_to_uuid(data: dict) -> dict:
    from copy import deepcopy

    result = deepcopy(data)
    for key, value in result.items():
        if isinstance(value, str):
            try:
                result[key] = UUID(value)
            except ValueError:
                pass
    return result


def decode_token(
    token: str,
    secret_key: str = SECRET_KEY,
    algorithm: str = ALGORITHM,
    db: Optional[Session] = None,
    revoked_model: Any = None,
) -> Optional[Dict[str, Any]]:
    try:
        if db is not None and revoked_model is not None:
            revoked = (
                db.query(revoked_model)
                .filter(
                    revoked_model.token == token,
                    revoked_model.is_used == True,  # noqa: E712
                )
                .first()
            )
            if revoked:
                return None
        payload = jwt.decode(
            token, secret_key, algorithms=[algorithm], options={"verify_exp": True}
        )
        return deep_convert_str_to_uuid(payload)
    except JWTError:
        return None


def revoke_token(
    token: str,
    db: Session,
    revoked_model: Any,
    user_id: Optional[UUID] = None,
) -> None:
    """Blacklist a JWT. Prefer passing ``user_id`` when known (e.g. logout); otherwise decode payload."""
    uid = user_id
    if uid is None:
        payload = decode_token(token, db=None, revoked_model=None)
        if payload:
            raw = payload.get("user_id")
            if raw is not None:
                try:
                    uid = UUID(str(raw))
                except (ValueError, TypeError):
                    uid = None
    revoked_entry = revoked_model(
        token=token,
        user_id=uid,
        revoked_at=datetime.now(timezone.utc),
        is_used=True,
    )
    db.add(revoked_entry)
    db.commit()


def get_user_id_from_token(token: str) -> Optional[UUID]:
    payload = decode_token(token)
    if not payload or "user_id" not in payload:
        return None
    return UUID(str(payload["user_id"]))
