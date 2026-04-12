from decimal import Decimal
from pathlib import Path
from urllib.parse import quote_plus
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.core.authorization import is_effective_superadmin
from app.core.database import get_db
from app.dependencies.auth import require_permissions, require_superadmin
from app.domains.company.models.company import Companies
from app.domains.user.models.user_company_memberships import UserCompanyMembership
from app.domains.user.models.users import Users
from app.core.config import settings
from app.domains.user.services.company_membership import ensure_membership, user_has_membership

router = APIRouter(prefix="/companies", tags=["Companies"])

LOGO_MAX_BYTES = 2 * 1024 * 1024
LOGO_CONTENT_TYPES: dict[str, str] = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


class CompanyOwnerRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: EmailStr
    first_name: str
    last_name: str


class CompanyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    phone: str | None
    website: str | None
    email: str | None
    address: str | None = None
    maps_url: str | None = None
    owner_user_id: UUID | None = None
    owner: CompanyOwnerRef | None = None
    logo_url: str | None = None
    tax_rate_percent: Decimal | None = None
    is_deleted: bool = False


class CompanyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=500)
    phone: str | None = Field(None, max_length=64)
    website: str | None = Field(None, max_length=500)
    email: str | None = Field(None, max_length=320)
    address: str | None = Field(None, max_length=2000)
    owner_user_id: UUID | None = None


class CompanyPatch(BaseModel):
    model_config = ConfigDict(extra="ignore")

    is_deleted: bool | None = None
    name: str | None = Field(None, min_length=1, max_length=500)
    phone: str | None = Field(None, max_length=64)
    website: str | None = Field(None, max_length=500)
    email: str | None = Field(None, max_length=320)
    address: str | None = Field(None, max_length=2000)
    owner_user_id: UUID | None = None
    tax_rate_percent: Decimal | None = Field(None, ge=0, le=100)


def _normalize_optional_str(v: str | None, max_len: int) -> str | None:
    if not v or not str(v).strip():
        return None
    return str(v).strip()[:max_len]


def _maps_url_from_address(address: str | None) -> str | None:
    """Adresten Google Maps arama URL’si (query parametreli)."""
    n = _normalize_optional_str(address, 2000)
    if not n:
        return None
    q = quote_plus(n)
    return f"https://www.google.com/maps/search/?api=1&query={q}"[:2000]


def _apply_company_search(q, raw: str | None):
    if not raw or not raw.strip():
        return q
    term = f"%{raw.strip()}%"
    return q.filter(
        or_(
            Companies.name.ilike(term),
            Companies.email.ilike(term),
            Companies.phone.ilike(term),
            Companies.website.ilike(term),
            Companies.address.ilike(term),
        ),
    )


def _company_base_query(db: Session):
    return db.query(Companies).options(joinedload(Companies.owner_user))


def _to_company_out(row: Companies) -> CompanyOut:
    owner = None
    if row.owner_user_id and row.owner_user is not None:
        u = row.owner_user
        owner = CompanyOwnerRef(
            id=u.id,
            email=u.email,
            first_name=u.first_name,
            last_name=u.last_name,
        )
    return CompanyOut(
        id=row.id,
        name=row.name,
        phone=row.phone,
        website=row.website,
        email=row.email,
        address=row.address,
        maps_url=row.maps_url,
        owner_user_id=row.owner_user_id,
        owner=owner,
        logo_url=row.logo_url,
        tax_rate_percent=(
            Decimal(str(row.tax_rate_percent)) if row.tax_rate_percent is not None else None
        ),
        is_deleted=bool(row.is_deleted),
    )


def _logo_disk_dir(company_id: UUID) -> Path:
    return settings.resolved_upload_root() / "companies" / str(company_id)


def _remove_logo_files(company_id: UUID) -> None:
    d = _logo_disk_dir(company_id)
    if not d.is_dir():
        return
    for p in d.glob("logo.*"):
        try:
            p.unlink()
        except OSError:
            pass


def _logo_extension(content_type: str | None) -> str | None:
    if not content_type:
        return None
    ct = content_type.split(";")[0].strip().lower()
    return LOGO_CONTENT_TYPES.get(ct)


def _require_owner_user(db: Session, user_id: UUID) -> Users:
    u = db.query(Users).filter(Users.id == user_id, Users.is_deleted.is_(False)).first()
    if not u:
        raise HTTPException(status_code=400, detail="Owner user not found or inactive.")
    return u


@router.get("", response_model=list[CompanyOut])
def list_companies(
    db: Session = Depends(get_db),
    current_user: Users = Depends(require_permissions("companies.view")),
    include_deleted: bool = Query(False),
    search: str | None = Query(None, max_length=200),
):
    if include_deleted and not is_effective_superadmin(
        db, current_user.id, getattr(current_user, "active_role", None)
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Including deleted companies is not allowed.",
        )
    q = _company_base_query(db)
    if not include_deleted:
        q = q.filter(Companies.is_deleted.is_(False))
    q = _apply_company_search(q, search)
    q = q.order_by(Companies.name)
    if is_effective_superadmin(db, current_user.id, getattr(current_user, "active_role", None)):
        return [_to_company_out(r) for r in q.all()]
    mids = [
        row[0]
        for row in db.query(UserCompanyMembership.company_id)
        .filter(
            UserCompanyMembership.user_id == current_user.id,
            UserCompanyMembership.is_deleted.is_(False),
        )
        .all()
    ]
    if not mids:
        return []
    return [_to_company_out(r) for r in q.filter(Companies.id.in_(mids)).all()]


@router.get("/{company_id}", response_model=CompanyOut)
def get_company(
    company_id: UUID,
    db: Session = Depends(get_db),
    current_user: Users = Depends(require_permissions("companies.view")),
):
    row = _company_base_query(db).filter(Companies.id == company_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Company not found.")
    super_u = is_effective_superadmin(
        db, current_user.id, getattr(current_user, "active_role", None)
    )
    if super_u:
        return _to_company_out(row)
    if not user_has_membership(db, current_user.id, company_id):
        raise HTTPException(status_code=403, detail="Not allowed.")
    if row.is_deleted:
        raise HTTPException(status_code=404, detail="Company not found.")
    return _to_company_out(row)


@router.post("", response_model=CompanyOut, status_code=status.HTTP_201_CREATED)
def create_company(
    body: CompanyCreate,
    db: Session = Depends(get_db),
    current_user: Users = Depends(require_superadmin),
):
    dup = (
        db.query(Companies)
        .filter(
            Companies.name == body.name.strip(),
            Companies.is_deleted.is_(False),
        )
        .first()
    )
    if dup:
        raise HTTPException(status_code=409, detail="A company with this name already exists.")
    addr = _normalize_optional_str(body.address, 2000)
    row = Companies(
        name=body.name.strip(),
        phone=(body.phone.strip() if body.phone and body.phone.strip() else None),
        website=(body.website.strip() if body.website and body.website.strip() else None),
        email=(body.email.strip() if body.email and body.email.strip() else None),
        address=addr,
        maps_url=_maps_url_from_address(addr),
        owner_user_id=None,
        is_deleted=False,
    )
    db.add(row)
    try:
        db.flush()
        if body.owner_user_id:
            _require_owner_user(db, body.owner_user_id)
            ensure_membership(db, body.owner_user_id, row.id, commit=False)
            row.owner_user_id = body.owner_user_id
        db.commit()
        db.refresh(row)
        row = _company_base_query(db).filter(Companies.id == row.id).one()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Could not create company (name may conflict with an inactive record).",
        ) from None
    return _to_company_out(row)


@router.patch("/{company_id}", response_model=CompanyOut)
def patch_company(
    company_id: UUID,
    body: CompanyPatch,
    db: Session = Depends(get_db),
    current_user: Users = Depends(require_permissions("companies.edit")),
):
    row = db.query(Companies).filter(Companies.id == company_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Company not found.")
    super_u = is_effective_superadmin(
        db, current_user.id, getattr(current_user, "active_role", None)
    )
    if not super_u:
        if not user_has_membership(db, current_user.id, company_id):
            raise HTTPException(status_code=403, detail="Not allowed.")
        if row.is_deleted:
            raise HTTPException(status_code=404, detail="Company not found.")

    raw = body.model_dump(exclude_unset=True)
    owner_key_in_payload = "owner_user_id" in raw

    if not super_u:
        if raw.get("is_deleted") is not None or owner_key_in_payload:
            raise HTTPException(
                status_code=403,
                detail="Only a superadmin can change company owner or active status.",
            )
        raw = {
            k: v
            for k, v in raw.items()
            if k in ("name", "phone", "email", "website", "address", "tax_rate_percent")
        }
        owner_key_in_payload = False

    if raw.get("is_deleted") is True:
        raise HTTPException(status_code=400, detail="Use DELETE to deactivate a company.")

    if raw.get("is_deleted") is False:
        if row.is_deleted:
            clash = (
                db.query(Companies)
                .filter(
                    Companies.name == row.name,
                    Companies.id != company_id,
                    Companies.is_deleted.is_(False),
                )
                .first()
            )
            if clash:
                raise HTTPException(
                    status_code=409,
                    detail="Another active company already uses this name. Rename before restoring.",
                )
            row.is_deleted = False
        raw.pop("is_deleted", None)
    elif "is_deleted" in raw:
        raw.pop("is_deleted", None)

    if "name" in raw:
        new_name = (raw["name"] or "").strip()
        if not new_name:
            raise HTTPException(status_code=400, detail="Name cannot be empty.")
        dup = (
            db.query(Companies)
            .filter(
                Companies.name == new_name,
                Companies.id != company_id,
                Companies.is_deleted.is_(False),
            )
            .first()
        )
        if dup:
            raise HTTPException(status_code=409, detail="A company with this name already exists.")
        row.name = new_name

    if "phone" in raw:
        v = raw["phone"]
        row.phone = v.strip() if isinstance(v, str) and v.strip() else None

    if "email" in raw:
        v = raw["email"]
        row.email = v.strip() if isinstance(v, str) and v.strip() else None

    if "website" in raw:
        v = raw["website"]
        row.website = v.strip() if isinstance(v, str) and v.strip() else None

    if "address" in raw:
        row.address = _normalize_optional_str(raw.get("address"), 2000)
        row.maps_url = _maps_url_from_address(row.address)

    if "tax_rate_percent" in raw:
        tr = raw.get("tax_rate_percent")
        row.tax_rate_percent = None if tr is None else tr

    if owner_key_in_payload:
        new_owner = raw.get("owner_user_id")
        if new_owner is None:
            row.owner_user_id = None
        else:
            _require_owner_user(db, new_owner)
            ensure_membership(db, new_owner, company_id, commit=False)
            row.owner_user_id = new_owner

    if not raw and row not in db.dirty:
        db.refresh(row)
        row = _company_base_query(db).filter(Companies.id == company_id).one()
        return _to_company_out(row)

    try:
        db.commit()
        row = _company_base_query(db).filter(Companies.id == company_id).one()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Update conflicts with existing data.",
        ) from None
    return _to_company_out(row)


@router.post("/{company_id}/logo", response_model=CompanyOut)
async def upload_company_logo(
    company_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    _super: Users = Depends(require_superadmin),
):
    row = db.query(Companies).filter(Companies.id == company_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Company not found.")
    ext = _logo_extension(file.content_type)
    if not ext:
        raise HTTPException(
            status_code=400,
            detail="Invalid image type. Use PNG, JPEG, WebP, or GIF.",
        )
    data = await file.read()
    if len(data) > LOGO_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Logo too large (max 2MB).")
    dest_dir = _logo_disk_dir(company_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    _remove_logo_files(company_id)
    dest = dest_dir / f"logo{ext}"
    dest.write_bytes(data)
    row.logo_url = f"/uploads/companies/{company_id}/logo{ext}"
    db.commit()
    row = _company_base_query(db).filter(Companies.id == company_id).one()
    return _to_company_out(row)


@router.delete("/{company_id}/logo", response_model=CompanyOut)
def delete_company_logo(
    company_id: UUID,
    db: Session = Depends(get_db),
    current_user: Users = Depends(require_superadmin),
):
    row = db.query(Companies).filter(Companies.id == company_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Company not found.")
    _remove_logo_files(company_id)
    row.logo_url = None
    db.commit()
    row = _company_base_query(db).filter(Companies.id == company_id).one()
    return _to_company_out(row)


@router.delete("/{company_id}", response_model=CompanyOut)
def delete_company(
    company_id: UUID,
    db: Session = Depends(get_db),
    current_user: Users = Depends(require_superadmin),
):
    row = db.query(Companies).filter(Companies.id == company_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Company not found.")
    if row.is_deleted:
        raise HTTPException(status_code=400, detail="Company is already inactive.")
    row.is_deleted = True
    _remove_logo_files(company_id)
    row.logo_url = None
    db.commit()
    row = _company_base_query(db).filter(Companies.id == company_id).one()
    return _to_company_out(row)
