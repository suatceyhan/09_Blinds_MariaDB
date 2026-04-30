from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.domains.company.models.company import Companies
from app.domains.user.models.user_company_memberships import UserCompanyMembership
from app.domains.user.models.users import Users


def _uuid_candidates(u: UUID) -> tuple[str, str]:
    return (str(u), u.hex)


def active_membership_company_ids(db: Session, user_id: UUID) -> list[UUID]:
    # Mixed UUID storage (hex32 vs dashed36): use raw SQL with both candidates.
    d, h = _uuid_candidates(user_id)
    rows = db.execute(
        text(
            "SELECT company_id FROM user_company_memberships "
            "WHERE COALESCE(is_deleted,0)=0 AND (user_id=:d OR user_id=:h)"
        ),
        {"d": d, "h": h},
    ).fetchall()
    return [UUID(str(r[0])) for r in rows]


def user_has_membership(db: Session, user_id: UUID, company_id: UUID) -> bool:
    d, h = _uuid_candidates(user_id)
    row = db.execute(
        text(
            "SELECT 1 FROM user_company_memberships "
            "WHERE COALESCE(is_deleted,0)=0 AND company_id=:c AND (user_id=:d OR user_id=:h) "
            "LIMIT 1"
        ),
        {"c": str(company_id), "d": d, "h": h},
    ).first()
    return row is not None


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
            # Update via raw SQL to tolerate mixed users.id representation.
            d, h = _uuid_candidates(user.id)
            db.execute(
                text(
                    "UPDATE users SET company_id = NULL "
                    "WHERE (id = :d OR id = :h OR LOWER(email) = LOWER(:e))"
                ),
                {"d": d, "h": h, "e": user.email},
            )
            db.commit()
        return
    if user.company_id is None or user.company_id not in mids:
        d, h = _uuid_candidates(user.id)
        db.execute(
            text(
                "UPDATE users SET company_id = :c "
                "WHERE (id = :d OR id = :h OR LOWER(email) = LOWER(:e))"
            ),
            {"c": str(mids[0]), "d": d, "h": h, "e": user.email},
        )
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
