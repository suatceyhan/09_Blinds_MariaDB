from uuid import UUID

from sqlalchemy.orm import Session

from app.domains.company.models.company import Companies
from app.domains.user.models.user_company_memberships import UserCompanyMembership
from app.domains.user.models.users import Users


def active_membership_company_ids(db: Session, user_id: UUID) -> list[UUID]:
    rows = (
        db.query(UserCompanyMembership.company_id)
        .filter(
            UserCompanyMembership.user_id == user_id,
            UserCompanyMembership.is_deleted.is_(False),
        )
        .all()
    )
    return [r[0] for r in rows]


def user_has_membership(db: Session, user_id: UUID, company_id: UUID) -> bool:
    return (
        db.query(UserCompanyMembership)
        .filter(
            UserCompanyMembership.user_id == user_id,
            UserCompanyMembership.company_id == company_id,
            UserCompanyMembership.is_deleted.is_(False),
        )
        .first()
    ) is not None


def ensure_membership(db: Session, user_id: UUID, company_id: UUID, *, commit: bool = False) -> None:
    row = (
        db.query(UserCompanyMembership)
        .filter(
            UserCompanyMembership.user_id == user_id,
            UserCompanyMembership.company_id == company_id,
        )
        .first()
    )
    if row:
        if row.is_deleted:
            row.is_deleted = False
    else:
        db.add(
            UserCompanyMembership(
                user_id=user_id,
                company_id=company_id,
                is_deleted=False,
            )
        )
    if commit:
        db.commit()


def list_user_companies_for_me(db: Session, user_id: UUID) -> list[tuple[UUID, str]]:
    """Aktif üyelikler: (company_id, company_name)."""
    q = (
        db.query(Companies.id, Companies.name)
        .join(
            UserCompanyMembership,
            UserCompanyMembership.company_id == Companies.id,
        )
        .filter(
            UserCompanyMembership.user_id == user_id,
            UserCompanyMembership.is_deleted.is_(False),
            Companies.is_deleted.is_(False),
        )
        .order_by(Companies.name)
    )
    return [(r[0], r[1]) for r in q.all()]


def list_membership_companies_for_user_ids(
    db: Session, user_ids: list[UUID]
) -> dict[UUID, list[tuple[UUID, str]]]:
    """Birden fazla kullanıcı için üyelik şirketleri (directory listesi, tek ek sorgu)."""
    if not user_ids:
        return {}
    rows = (
        db.query(UserCompanyMembership.user_id, Companies.id, Companies.name)
        .join(Companies, Companies.id == UserCompanyMembership.company_id)
        .filter(
            UserCompanyMembership.user_id.in_(user_ids),
            UserCompanyMembership.is_deleted.is_(False),
            Companies.is_deleted.is_(False),
        )
        .order_by(UserCompanyMembership.user_id, Companies.name)
        .all()
    )
    out: dict[UUID, list[tuple[UUID, str]]] = {}
    for uid, cid, cname in rows:
        out.setdefault(uid, []).append((cid, cname))
    return out


def normalize_active_company(db: Session, user: Users) -> None:
    """users.company_id üyeliklerden biri değilse ilk üyeliğe çeker; üyelik yoksa NULL yapar."""
    mids = active_membership_company_ids(db, user.id)
    if not mids:
        if user.company_id is not None:
            user.company_id = None
            db.commit()
        return
    if user.company_id is None or user.company_id not in mids:
        user.company_id = mids[0]
        db.commit()


def soft_delete_membership(db: Session, user_id: UUID, company_id: UUID) -> bool:
    row = (
        db.query(UserCompanyMembership)
        .filter(
            UserCompanyMembership.user_id == user_id,
            UserCompanyMembership.company_id == company_id,
            UserCompanyMembership.is_deleted.is_(False),
        )
        .first()
    )
    if not row:
        return False
    row.is_deleted = True
    db.flush()
    u = db.query(Users).filter(Users.id == user_id).first()
    if u and u.company_id == company_id:
        mids = active_membership_company_ids(db, user_id)
        u.company_id = mids[0] if mids else None
    return True
