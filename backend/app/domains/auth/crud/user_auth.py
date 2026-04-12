from uuid import UUID

from sqlalchemy.orm import Session

from app.core.security import verify_password
from app.domains.user.models.users import Users


def get_user_auth_by_id(db: Session, user_id: UUID) -> Users | None:
    return db.query(Users).filter(Users.id == user_id).first()


def authenticate_user(
    db: Session,
    email: str,
    password: str,
    pepper: str = "",
) -> Users | None:
    user_auth = db.query(Users).filter(Users.email == email).first()
    if not user_auth:
        return None
    if not verify_password(password, user_auth.password, pepper=pepper):
        return None
    return user_auth


def update_password(
    db: Session,
    user_id: UUID,
    new_hashed_password: str,
) -> Users | None:
    user_auth = db.query(Users).filter(Users.id == user_id).first()
    if not user_auth:
        return None
    user_auth.password = new_hashed_password
    user_auth.is_password_set = True
    user_auth.must_change_password = False
    user_auth.failed_login_attempts = 0
    user_auth.account_locked_until = None
    db.commit()
    db.refresh(user_auth)
    return user_auth
