from sqlalchemy.orm import Session

from app.domains.user.models.users import Users


def list_users_minimal(db: Session, *, skip: int = 0, limit: int = 500) -> list[Users]:
    return (
        db.query(Users)
        .filter(Users.is_deleted.is_(False))
        .order_by(Users.email)
        .offset(skip)
        .limit(limit)
        .all()
    )
