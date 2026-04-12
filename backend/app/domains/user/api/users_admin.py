from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.authorization import (
    enforce_permission,
    has_permission,
    is_effective_superadmin,
    user_has_superadmin_assignment,
)
from app.core.config import settings
from app.core.database import get_db
from app.core.security import hash_password
from app.dependencies.auth import effective_company_id, get_current_user, resolve_tenant_company_id
from app.domains.company.models.company import Companies
from app.domains.lookup.models.roles import Roles
from app.domains.user.models.user_company_memberships import UserCompanyMembership
from app.domains.user.models.user_roles import UserRoles
from app.domains.user.models.users import Users
from app.domains.user.schemas.users_admin import (
    AddCompanyMembershipIn,
    CompanyMembershipRef,
    UserCreateIn,
    UserListItemOut,
    UserUpdateIn,
)
from app.domains.user.services.company_membership import (
    ensure_membership,
    list_membership_companies_for_user_ids,
    list_user_companies_for_me,
    soft_delete_membership,
)

router = APIRouter(prefix="/users", tags=["Users (admin)"])


def _scoped_directory_user(
    db: Session,
    current_user: Users,
    user_id: UUID,
    *,
    allow_inactive: bool,
) -> Users:
    """Dizin işlemleri: süperadmin herkes; şirket yöneticisi yalnızca üyelik kapsamı."""
    super_u = is_effective_superadmin(
        db, current_user.id, getattr(current_user, "active_role", None)
    )
    target = db.query(Users).filter(Users.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    if not allow_inactive and target.is_deleted:
        raise HTTPException(
            status_code=400,
            detail="User is inactive. Restore the account first.",
        )
    if user_has_superadmin_assignment(db, user_id) and not super_u:
        raise HTTPException(
            status_code=403,
            detail="Only a superadmin can modify this user.",
        )
    if super_u:
        return target
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    m = (
        db.query(UserCompanyMembership)
        .filter(
            UserCompanyMembership.user_id == user_id,
            UserCompanyMembership.company_id == cid,
            UserCompanyMembership.is_deleted.is_(False),
        )
        .first()
    )
    if not m:
        raise HTTPException(status_code=403, detail="User is not in your company.")
    return target


def _ensure_user_role_row(db: Session, user_id: UUID, role_id: UUID) -> None:
    ur = (
        db.query(UserRoles)
        .filter(UserRoles.user_id == user_id, UserRoles.role_id == role_id)
        .first()
    )
    if ur:
        if ur.is_deleted:
            ur.is_deleted = False
    else:
        db.add(UserRoles(user_id=user_id, role_id=role_id, is_deleted=False))


def _user_to_list_item(db: Session, u: Users) -> UserListItemOut:
    def role_names_for(uid: UUID) -> list[str]:
        return [
            r[0]
            for r in (
                db.query(Roles.name)
                .join(UserRoles, UserRoles.role_id == Roles.id)
                .filter(
                    UserRoles.user_id == uid,
                    UserRoles.is_deleted.is_(False),
                    Roles.is_deleted.is_(False),
                )
                .all()
            )
        ]

    cn = None
    if u.company_id:
        co = (
            db.query(Companies.name)
            .filter(Companies.id == u.company_id, Companies.is_deleted.is_(False))
            .first()
        )
        if co:
            cn = co[0]
    companies = [
        CompanyMembershipRef(id=cid, name=cname)
        for cid, cname in list_user_companies_for_me(db, u.id)
    ]
    return UserListItemOut(
        id=u.id,
        email=u.email,
        first_name=u.first_name,
        last_name=u.last_name,
        phone=u.phone,
        company_id=u.company_id,
        company_name=cn,
        companies=companies,
        is_deleted=bool(u.is_deleted),
        roles=role_names_for(u.id),
    )


def _active_role(user: Users) -> str | None:
    return getattr(user, "active_role", None) or (user.roles[0] if user.roles else None)


@router.get("", response_model=list[UserListItemOut])
def list_users_for_admin(
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=500),
    search: str | None = Query(None, max_length=200),
    role: str | None = Query(None, max_length=120),
    company_id: UUID | None = Query(None),
    include_deleted: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    ar = _active_role(current_user)
    if not has_permission(db, current_user.id, "users.directory.view", ar):
        raise HTTPException(status_code=403, detail="Missing users.directory.view permission.")
    super = is_effective_superadmin(
        db, current_user.id, getattr(current_user, "active_role", None)
    )
    if include_deleted and not super:
        raise HTTPException(
            status_code=403,
            detail="Including deactivated users is not allowed.",
        )

    q = db.query(Users)
    if not include_deleted:
        q = q.filter(Users.is_deleted.is_(False))

    if search and search.strip():
        term = f"%{search.strip()}%"
        q = q.filter(
            or_(
                Users.email.ilike(term),
                Users.first_name.ilike(term),
                Users.last_name.ilike(term),
                Users.phone.ilike(term),
            )
        )

    if role and role.strip():
        rn = role.strip()
        q = q.filter(
            Users.id.in_(
                db.query(UserRoles.user_id)
                .join(Roles, Roles.id == UserRoles.role_id)
                .filter(
                    UserRoles.is_deleted.is_(False),
                    Roles.is_deleted.is_(False),
                    Roles.name.ilike(f"%{rn}%"),
                )
            )
        )

    tenant_cid = resolve_tenant_company_id(db, current_user, company_id_param=company_id)
    q = (
        q.join(
            UserCompanyMembership,
            UserCompanyMembership.user_id == Users.id,
        )
        .filter(
            UserCompanyMembership.company_id == tenant_cid,
            UserCompanyMembership.is_deleted.is_(False),
        )
        .distinct()
    )

    rows = q.order_by(Users.email).offset(skip).limit(limit).all()

    def role_names_for(uid: UUID) -> list[str]:
        return [
            r[0]
            for r in (
                db.query(Roles.name)
                .join(UserRoles, UserRoles.role_id == Roles.id)
                .filter(
                    UserRoles.user_id == uid,
                    UserRoles.is_deleted.is_(False),
                    Roles.is_deleted.is_(False),
                )
                .all()
            )
        ]

    companies_map = list_membership_companies_for_user_ids(db, [u.id for u in rows])
    out: list[UserListItemOut] = []
    for u in rows:
        cn = None
        if u.company_id:
            co = (
                db.query(Companies.name)
                .filter(Companies.id == u.company_id, Companies.is_deleted.is_(False))
                .first()
            )
            if co:
                cn = co[0]
        pairs = companies_map.get(u.id, [])
        companies = [CompanyMembershipRef(id=cid, name=cname) for cid, cname in pairs]
        out.append(
            UserListItemOut(
                id=u.id,
                email=u.email,
                first_name=u.first_name,
                last_name=u.last_name,
                phone=u.phone,
                company_id=u.company_id,
                company_name=cn,
                companies=companies,
                is_deleted=bool(u.is_deleted),
                roles=role_names_for(u.id),
            )
        )
    return out


@router.get("/{user_id}", response_model=UserListItemOut)
def get_directory_user(
    user_id: UUID,
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    ar = _active_role(current_user)
    if not has_permission(db, current_user.id, "users.directory.view", ar):
        raise HTTPException(status_code=403, detail="Missing users.directory.view permission.")
    super_u = is_effective_superadmin(
        db, current_user.id, getattr(current_user, "active_role", None)
    )
    target = db.query(Users).filter(Users.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")
    if user_has_superadmin_assignment(db, user_id) and not super_u:
        raise HTTPException(status_code=403, detail="Only a superadmin can view this user.")
    if target.is_deleted and not super_u:
        raise HTTPException(status_code=404, detail="User not found.")
    if not super_u:
        cid = effective_company_id(current_user)
        if not cid:
            raise HTTPException(status_code=403, detail="No active company.")
        m = (
            db.query(UserCompanyMembership)
            .filter(
                UserCompanyMembership.user_id == user_id,
                UserCompanyMembership.company_id == cid,
                UserCompanyMembership.is_deleted.is_(False),
            )
            .first()
        )
        if not m:
            raise HTTPException(status_code=403, detail="User is not in your company.")
    return _user_to_list_item(db, target)


@router.post("", response_model=UserListItemOut, status_code=status.HTTP_201_CREATED)
def create_directory_user(
    body: UserCreateIn,
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    ar = _active_role(current_user)
    enforce_permission(db, current_user.id, "users.directory.edit", ar)
    super = is_effective_superadmin(
        db, current_user.id, getattr(current_user, "active_role", None)
    )

    target_company: UUID | None = body.company_id if super else effective_company_id(current_user)
    if not super and not target_company:
        raise HTTPException(
            status_code=403,
            detail="You must belong to a company to create users for it.",
        )

    email = body.email.strip().lower()
    if db.query(Users).filter(Users.email == email, Users.is_deleted.is_(False)).first():
        raise HTTPException(status_code=409, detail="This email is already in use.")
    phone = body.phone.strip()
    if db.query(Users).filter(Users.phone == phone, Users.is_deleted.is_(False)).first():
        raise HTTPException(status_code=409, detail="This phone number is already in use.")

    role_name = (body.default_role_name or settings.default_registered_role_name or "user").strip()
    role_row = (
        db.query(Roles)
        .filter(Roles.name == role_name, Roles.is_deleted.is_(False))
        .first()
    )
    if not role_row:
        raise HTTPException(status_code=400, detail=f"Unknown role: {role_name}")

    if target_company:
        co = (
            db.query(Companies)
            .filter(Companies.id == target_company, Companies.is_deleted.is_(False))
            .first()
        )
        if not co:
            raise HTTPException(status_code=400, detail="Company not found.")
        if not super and effective_company_id(current_user) != target_company:
            raise HTTPException(status_code=403, detail="Cannot assign users outside your company.")

    new_user = Users(
        first_name=body.first_name.strip(),
        last_name=body.last_name.strip(),
        phone=phone,
        email=email,
        password=hash_password(body.password, settings.password_pepper),
        is_password_set=True,
        must_change_password=False,
        is_deleted=False,
        default_role=role_row.id,
        company_id=target_company,
    )
    db.add(new_user)
    db.flush()
    db.add(UserRoles(user_id=new_user.id, role_id=role_row.id, is_deleted=False))
    if target_company:
        ensure_membership(db, new_user.id, target_company, commit=False)
        new_user.company_id = target_company
    db.commit()
    db.refresh(new_user)

    cn = None
    if new_user.company_id:
        cc = (
            db.query(Companies.name)
            .filter(Companies.id == new_user.company_id, Companies.is_deleted.is_(False))
            .first()
        )
        if cc:
            cn = cc[0]

    companies = [
        CompanyMembershipRef(id=cid, name=cname)
        for cid, cname in list_user_companies_for_me(db, new_user.id)
    ]
    return UserListItemOut(
        id=new_user.id,
        email=new_user.email,
        first_name=new_user.first_name,
        last_name=new_user.last_name,
        phone=new_user.phone,
        company_id=new_user.company_id,
        company_name=cn,
        companies=companies,
        is_deleted=bool(new_user.is_deleted),
        roles=[role_row.name],
    )


@router.patch("/{user_id}", response_model=UserListItemOut)
def update_directory_user(
    user_id: UUID,
    body: UserUpdateIn,
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    ar = _active_role(current_user)
    enforce_permission(db, current_user.id, "users.directory.edit", ar)
    super_u = is_effective_superadmin(
        db, current_user.id, getattr(current_user, "active_role", None)
    )
    target = _scoped_directory_user(db, current_user, user_id, allow_inactive=False)

    if body.email is not None:
        email = str(body.email).strip().lower()
        taken = (
            db.query(Users)
            .filter(Users.email == email, Users.id != user_id)
            .first()
        )
        if taken:
            raise HTTPException(status_code=409, detail="This email is already in use.")
        target.email = email

    if body.phone is not None:
        phone = body.phone.strip()
        taken = (
            db.query(Users)
            .filter(Users.phone == phone, Users.id != user_id)
            .first()
        )
        if taken:
            raise HTTPException(status_code=409, detail="This phone number is already in use.")
        target.phone = phone

    if body.first_name is not None:
        target.first_name = body.first_name.strip()
    if body.last_name is not None:
        target.last_name = body.last_name.strip()
    if body.password is not None:
        target.password = hash_password(body.password, settings.password_pepper)
        target.is_password_set = True

    if body.default_role_name is not None:
        rn = body.default_role_name.strip()
        if rn.lower() == "superadmin" and not super_u:
            raise HTTPException(status_code=403, detail="Cannot assign superadmin role.")
        role_row = (
            db.query(Roles)
            .filter(Roles.name == rn, Roles.is_deleted.is_(False))
            .first()
        )
        if not role_row:
            raise HTTPException(status_code=400, detail=f"Unknown role: {rn}")
        target.default_role = role_row.id
        _ensure_user_role_row(db, target.id, role_row.id)

    db.commit()
    db.refresh(target)
    return _user_to_list_item(db, target)


@router.delete("/{user_id}", response_model=dict)
def soft_delete_directory_user(
    user_id: UUID,
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    ar = _active_role(current_user)
    enforce_permission(db, current_user.id, "users.directory.edit", ar)
    target = _scoped_directory_user(db, current_user, user_id, allow_inactive=False)
    if target.id == current_user.id:
        raise HTTPException(status_code=403, detail="You cannot deactivate your own account here.")
    if target.is_deleted:
        raise HTTPException(status_code=400, detail="User is already inactive.")
    target.is_deleted = True
    db.commit()
    return {"ok": True}


@router.post("/{user_id}/restore", response_model=UserListItemOut)
def restore_directory_user(
    user_id: UUID,
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    ar = _active_role(current_user)
    enforce_permission(db, current_user.id, "users.directory.edit", ar)
    target = _scoped_directory_user(db, current_user, user_id, allow_inactive=True)
    if not target.is_deleted:
        raise HTTPException(status_code=400, detail="User is already active.")
    target.is_deleted = False
    db.commit()
    db.refresh(target)
    return _user_to_list_item(db, target)


@router.post("/{user_id}/companies", response_model=dict)
def add_user_company_membership(
    user_id: UUID,
    body: AddCompanyMembershipIn,
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    ar = _active_role(current_user)
    enforce_permission(db, current_user.id, "users.directory.edit", ar)
    super = is_effective_superadmin(
        db, current_user.id, getattr(current_user, "active_role", None)
    )

    if not super:
        ec = effective_company_id(current_user)
        if not ec or body.company_id != ec:
            raise HTTPException(
                status_code=403,
                detail="You can only link users to your own company.",
            )

    target = db.query(Users).filter(Users.id == user_id, Users.is_deleted.is_(False)).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")

    co = (
        db.query(Companies)
        .filter(Companies.id == body.company_id, Companies.is_deleted.is_(False))
        .first()
    )
    if not co:
        raise HTTPException(status_code=400, detail="Company not found.")

    ensure_membership(db, target.id, body.company_id, commit=False)
    if target.company_id is None:
        target.company_id = body.company_id
    db.commit()
    return {"ok": True}


@router.delete("/{user_id}/companies/{company_id}", response_model=dict)
def remove_user_company_membership(
    user_id: UUID,
    company_id: UUID,
    db: Session = Depends(get_db),
    current_user: Users = Depends(get_current_user),
):
    ar = _active_role(current_user)
    enforce_permission(db, current_user.id, "users.directory.edit", ar)
    super = is_effective_superadmin(
        db, current_user.id, getattr(current_user, "active_role", None)
    )

    if not super:
        ec = effective_company_id(current_user)
        if not ec or company_id != ec:
            raise HTTPException(status_code=403, detail="Not allowed.")

    target = db.query(Users).filter(Users.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found.")

    if not soft_delete_membership(db, user_id, company_id):
        raise HTTPException(status_code=404, detail="Membership not found.")
    db.commit()
    return {"ok": True}
