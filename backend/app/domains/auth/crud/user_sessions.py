from typing import List, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.domains.auth.models.user_sessions import UserSessions
from app.domains.auth.schemas.user_sessions import UserSessionCreate, UserSessionUpdate


def get_user_sessions(
    db: Session, skip: Optional[int] = None, limit: Optional[int] = None
) -> List[UserSessions]:
    q = db.query(UserSessions)
    if skip is not None:
        q = q.offset(skip)
    if limit is not None:
        q = q.limit(limit)
    return q.all()


def get_user_session(db: Session, session_id: UUID) -> Optional[UserSessions]:
    return db.query(UserSessions).filter(UserSessions.id == session_id).first()


def create_user_session(db: Session, session_in: UserSessionCreate) -> UserSessions:
    db_session = UserSessions(**session_in.model_dump())
    db.add(db_session)
    db.commit()
    db.refresh(db_session)
    return db_session


def update_user_session(
    db: Session, session_id: UUID, session_in: UserSessionUpdate
) -> Optional[UserSessions]:
    db_session = get_user_session(db, session_id)
    if db_session:
        for key, value in session_in.model_dump(exclude_unset=True).items():
            setattr(db_session, key, value)
        db.commit()
        db.refresh(db_session)
    return db_session


def deactivate_all_sessions_for_user(db: Session, user_id: UUID) -> None:
    db.query(UserSessions).filter(
        UserSessions.user_id == user_id,
        UserSessions.is_active == True,  # noqa: E712
    ).update({UserSessions.is_active: False})
    db.commit()
