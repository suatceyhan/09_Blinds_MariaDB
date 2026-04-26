import json
import re
import secrets
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Literal
from uuid import UUID
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from app.core.database import get_db
from app.core.person_names import format_person_name_casing
from app.dependencies.auth import effective_company_id, require_permissions
from app.domains.business_lookups.services.blinds_catalog import (
    assert_blinds_types_enabled_for_company,
)
from app.domains.business_lookups.services.estimate_status_defaults import (
    ensure_default_estimate_statuses_for_company,
)
from app.domains.user.models.users import Users
from app.integrations.google_calendar_service import try_push_estimate_to_google_calendar
from app.domains.settings.api.contract_invoice_docs import render_contract_invoice_pdf
from app.utils.email import send_html_email


router = APIRouter(prefix="/estimates", tags=["Estimates"])


def _new_estimate_id() -> str:
    return secrets.token_hex(8)


_SQL_BLINDS_TYPES_JSON = """
  COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'id', bt.id,
          'name', bt.name,
          'window_count', eb.perde_sayisi,
          'line_amount', eb.line_amount
        )
        ORDER BY eb.sort_order, bt.name
      )
      FROM estimate_blinds eb
      JOIN blinds_type bt ON bt.id = eb.blinds_id
      WHERE eb.company_id = e.company_id AND eb.estimate_id = e.id
    ),
    CASE
      WHEN e.blinds_id IS NOT NULL THEN
        (SELECT json_build_array(
          json_build_object(
            'id', bt.id,
            'name', bt.name,
            'window_count', e.perde_sayisi,
            'line_amount', NULL
          )
        )
         FROM blinds_type bt
         WHERE bt.id = e.blinds_id)
      ELSE '[]'::json
    END
  )
"""


def _coerce_guest_emails_column(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(x) for x in raw]
    if isinstance(raw, str):
        try:
            j = json.loads(raw)
            return [str(x) for x in j] if isinstance(j, list) else []
        except json.JSONDecodeError:
            return []
    return []


def _scheduled_wall_for_detail(
    scheduled_start_at: Any,
    tarih_saat: Any,
    visit_time_zone: str | None,
) -> str | None:
    start = scheduled_start_at or tarih_saat
    if start is None:
        return None
    name = (visit_time_zone or "").strip() or "UTC"
    try:
        z = ZoneInfo(name)
    except Exception:
        z = ZoneInfo("UTC")
    s = start
    if getattr(s, "tzinfo", None) is None:
        s = s.replace(tzinfo=timezone.utc)
    local = s.astimezone(z)
    return local.strftime("%Y-%m-%dT%H:%M")


def _normalize_blinds_lines(raw: Any) -> list[dict[str, Any]]:
    if raw is None:
        return []
    if isinstance(raw, str):
        return []
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict) or "id" not in item or "name" not in item:
            continue
        wc_raw = item.get("window_count")
        window_count: int | None = None
        if wc_raw is not None and wc_raw != "":
            try:
                window_count = int(wc_raw)
            except (TypeError, ValueError):
                window_count = None
        la_raw = item.get("line_amount")
        line_amount: float | None = None
        if la_raw is not None and la_raw != "":
            try:
                d = Decimal(str(la_raw)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                if d < 0:
                    continue
                line_amount = float(d)
            except Exception:
                line_amount = None
        row: dict[str, Any] = {
            "id": str(item["id"]),
            "name": str(item["name"]),
            "window_count": window_count,
        }
        if line_amount is not None:
            row["line_amount"] = line_amount
        out.append(row)
    return out


class BlindsTypeOptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str


class EstimateStatusLookupOptOut(BaseModel):
    """Active estimate statuses for Estimates list chips (`estimates.view`).

    Built-in kinds are returned once each (even if the DB had duplicates). Custom rows (`code` null)
    whose label matches a chosen built-in row's name (case-insensitive) are omitted so filters do
    not show duplicate titles. Full rows remain under `/lookups/estimate-statuses`.
    """

    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    sort_order: int = 0
    code: str | None = Field(
        default=None,
        description="new | pending | converted | cancelled when row is built-in; null for custom labels.",
    )


class EstimateGuestOptionOut(BaseModel):
    email: str
    label: str


class EstimateCreateContextOut(BaseModel):
    """Company-backed defaults for the new-estimate form (organizer + member guest list)."""

    organizer_name: str
    organizer_email: str | None = None
    guest_options: list[EstimateGuestOptionOut] = Field(default_factory=list)


class EstimateBlindsLineOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    window_count: int | None = None
    line_amount: float | None = None


class EstimateListItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: UUID
    customer_id: str | None = None
    customer_display: str
    customer_address: str | None = None
    customer_postal_code: str | None = None
    blinds_types: list[EstimateBlindsLineOut]
    perde_sayisi: int | None = None
    status: str | None = None
    status_label: str = "—"
    status_esti_id: str
    is_deleted: bool = False
    scheduled_start_at: datetime | None = None
    tarih_saat: datetime | None = None
    created_at: Any | None = None
    linked_order_id: str | None = None


class EstimateDetailOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    company_id: UUID
    customer_id: str | None = None
    customer_display: str
    customer_address: str | None = None
    customer_postal_code: str | None = None
    prospect_name: str | None = None
    prospect_surname: str | None = None
    prospect_phone: str | None = None
    prospect_email: str | None = None
    prospect_address: str | None = None
    prospect_postal_code: str | None = None
    lead_source: str | None = Field(
        default=None,
        description="referral | advertising | null (unknown)",
    )
    blinds_types: list[EstimateBlindsLineOut]
    perde_sayisi: int | None = None
    scheduled_wall: str | None = Field(
        None,
        description="Visit start as YYYY-MM-DDTHH:mm in visit_time_zone (for forms).",
    )
    scheduled_start_at: datetime | None = None
    scheduled_end_at: datetime | None = None
    tarih_saat: datetime | None = None
    lead_id: UUID | None = None
    calendar_provider: str | None = None
    google_event_id: str | None = None
    visit_time_zone: str | None = None
    visit_address: str | None = None
    visit_postal_code: str | None = None
    visit_notes: str | None = None
    visit_organizer_name: str | None = None
    visit_organizer_email: str | None = None
    visit_guest_emails: list[str] = Field(default_factory=list)
    visit_recurrence_rrule: str | None = None
    status: str | None = None
    status_label: str = "—"
    status_esti_id: str
    is_deleted: bool = False
    created_at: Any | None = None
    updated_at: Any | None = None
    linked_order_id: str | None = None


class EstimateBlindsLineIn(BaseModel):
    blinds_id: str = Field(min_length=1, max_length=16)
    window_count: int | None = Field(None, ge=1)
    line_amount: Decimal | None = Field(None, ge=0, max_digits=14, decimal_places=2)


_IANA_TZ_RE = re.compile(r"^[A-Za-z0-9_\/+\-]+$")


_WALL_SCHED_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")


class EstimateCreateIn(BaseModel):
    customer_id: str | None = Field(None, max_length=16)
    prospect_name: str | None = Field(None, max_length=500)
    prospect_surname: str | None = Field(None, max_length=500)
    prospect_phone: str | None = Field(None, max_length=100)
    prospect_email: EmailStr | None = None
    prospect_address: str | None = Field(None, max_length=2000)
    prospect_postal_code: str | None = Field(None, max_length=32)
    blinds_lines: list[EstimateBlindsLineIn] = Field(default_factory=list, max_length=24)
    scheduled_wall: str | None = Field(
        None,
        max_length=32,
        description="Visit start wall clock YYYY-MM-DDTHH:mm in visit_time_zone (preferred).",
    )
    scheduled_at: datetime | None = Field(
        None,
        description="Visit start as instant (legacy); omit if scheduled_wall is sent.",
    )
    visit_time_zone: str = Field(
        default="UTC",
        max_length=100,
        description="IANA timezone for scheduled_wall and Google Calendar.",
    )
    visit_address: str | None = Field(None, max_length=500)
    visit_postal_code: str | None = Field(None, max_length=32)
    visit_notes: str | None = Field(None, max_length=4000)
    visit_organizer_name: str | None = Field(None, max_length=200)
    visit_organizer_email: EmailStr | None = None
    visit_guest_emails: list[EmailStr] = Field(default_factory=list, max_length=20)
    lead_source: Literal["referral", "advertising"] | None = Field(
        default=None,
        description="referral | advertising. Null means unknown.",
    )

    @field_validator("visit_organizer_email", mode="before")
    @classmethod
    def organizer_email_empty(cls, v: Any) -> Any:
        if v is None or (isinstance(v, str) and not v.strip()):
            return None
        return v

    @field_validator("visit_guest_emails", mode="before")
    @classmethod
    def guest_emails_list(cls, v: Any) -> Any:
        if v is None:
            return []
        if not isinstance(v, list):
            raise ValueError("visit_guest_emails must be a list of email strings.")
        return [str(x).strip() for x in v if str(x).strip()]

    @field_validator("visit_guest_emails", mode="after")
    @classmethod
    def dedupe_guest_emails(cls, v: list) -> list:
        seen: set[str] = set()
        out: list = []
        for e in v:
            k = str(e).lower()
            if k not in seen:
                seen.add(k)
                out.append(e)
        return out

    @field_validator("visit_address", "visit_postal_code", "visit_notes", "visit_organizer_name", mode="before")
    @classmethod
    def strip_opt_str(cls, v: Any) -> Any:
        if v is None:
            return None
        if isinstance(v, str):
            s = v.strip()
            return s or None
        return v

    @field_validator("visit_time_zone", mode="before")
    @classmethod
    def tz_default_strip(cls, v: Any) -> Any:
        if v is None or (isinstance(v, str) and not v.strip()):
            return "UTC"
        return str(v).strip()

    @field_validator("visit_time_zone")
    @classmethod
    def tz_chars(cls, v: str) -> str:
        if not _IANA_TZ_RE.match(v):
            raise ValueError("Invalid time zone format.")
        return v

    @field_validator("scheduled_wall")
    @classmethod
    def wall_format(cls, v: str | None) -> str | None:
        if v is None:
            return None
        s = v.strip()
        if not s:
            return None
        if not _WALL_SCHED_RE.match(s):
            raise ValueError("scheduled_wall must be YYYY-MM-DDTHH:mm")
        return s

    @field_validator("blinds_lines")
    @classmethod
    def unique_blinds(cls, v: list[EstimateBlindsLineIn]) -> list[EstimateBlindsLineIn]:
        ids = [x.blinds_id.strip() for x in v]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate blinds types are not allowed.")
        return v

    @field_validator(
        "prospect_name",
        "prospect_surname",
        "prospect_phone",
        "prospect_address",
        "prospect_postal_code",
        mode="before",
    )
    @classmethod
    def strip_prospect_str(cls, v: Any) -> Any:
        if v is None:
            return None
        if isinstance(v, str):
            s = v.strip()
            return s or None
        return v

    @model_validator(mode="after")
    def schedule_source(self) -> "EstimateCreateIn":
        if self.scheduled_wall is None and self.scheduled_at is None:
            raise ValueError("Provide scheduled_wall (with visit_time_zone) or scheduled_at.")
        return self

    @model_validator(mode="after")
    def customer_or_prospect(self) -> "EstimateCreateIn":
        cid = (self.customer_id or "").strip()
        if cid:
            self.customer_id = cid
            return self
        pn = (self.prospect_name or "").strip()
        if not pn:
            raise ValueError("Either customer_id or prospect_name is required.")
        self.customer_id = None
        return self


class EstimatePatchIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    scheduled_wall: str | None = Field(None, max_length=32)
    visit_time_zone: str | None = Field(None, max_length=100)
    visit_notes: str | None = Field(None, max_length=4000)
    visit_address: str | None = Field(None, max_length=500)
    visit_postal_code: str | None = Field(None, max_length=32)
    visit_organizer_name: str | None = Field(None, max_length=200)
    visit_organizer_email: EmailStr | None = None
    visit_guest_emails: list[EmailStr] | None = Field(None, max_length=20)
    blinds_lines: list[EstimateBlindsLineIn] | None = Field(None, max_length=24)
    status_esti_id: str | None = Field(None, min_length=1, max_length=16)
    prospect_name: str | None = Field(None, max_length=500)
    prospect_surname: str | None = Field(None, max_length=500)
    prospect_phone: str | None = Field(None, max_length=100)
    prospect_email: EmailStr | None = None
    prospect_address: str | None = Field(None, max_length=2000)
    prospect_postal_code: str | None = Field(None, max_length=32)
    lead_source: Literal["referral", "advertising"] | None = None

    @field_validator(
        "prospect_name",
        "prospect_surname",
        "prospect_phone",
        "prospect_address",
        "prospect_postal_code",
        mode="before",
    )
    @classmethod
    def strip_prospect_patch(cls, v: Any) -> Any:
        if v is None:
            return None
        if isinstance(v, str):
            s = v.strip()
            return s or None
        return v

    @field_validator("visit_organizer_email", mode="before")
    @classmethod
    def organizer_email_empty_patch(cls, v: Any) -> Any:
        if v is None or (isinstance(v, str) and not v.strip()):
            return None
        return v

    @field_validator("visit_guest_emails", mode="before")
    @classmethod
    def guest_emails_list_patch(cls, v: Any) -> Any:
        if v is None:
            return None
        if not isinstance(v, list):
            raise ValueError("visit_guest_emails must be a list of email strings.")
        return [str(x).strip() for x in v if str(x).strip()]

    @field_validator("visit_guest_emails", mode="after")
    @classmethod
    def dedupe_guest_emails_patch(cls, v: list | None) -> list | None:
        if v is None:
            return None
        seen: set[str] = set()
        out: list = []
        for e in v:
            k = str(e).lower()
            if k not in seen:
                seen.add(k)
                out.append(e)
        return out

    @field_validator(
        "visit_notes",
        "visit_address",
        "visit_postal_code",
        "visit_organizer_name",
        "scheduled_wall",
        mode="before",
    )
    @classmethod
    def strip_opt_patch(cls, v: Any) -> Any:
        if v is None:
            return None
        if isinstance(v, str):
            s = v.strip()
            return s or None
        return v

    @field_validator("visit_time_zone", mode="before")
    @classmethod
    def tz_strip_patch(cls, v: Any) -> Any:
        if v is None or (isinstance(v, str) and not v.strip()):
            return None
        return str(v).strip()

    @field_validator("visit_time_zone")
    @classmethod
    def tz_chars_patch(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if not _IANA_TZ_RE.match(v):
            raise ValueError("Invalid time zone format.")
        return v

    @field_validator("scheduled_wall")
    @classmethod
    def wall_format_patch(cls, v: str | None) -> str | None:
        if v is None:
            return None
        if not _WALL_SCHED_RE.match(v):
            raise ValueError("scheduled_wall must be YYYY-MM-DDTHH:mm")
        return v

    @field_validator("blinds_lines")
    @classmethod
    def unique_blinds_patch(cls, v: list[EstimateBlindsLineIn] | None) -> list[EstimateBlindsLineIn] | None:
        if v is None:
            return None
        ids = [x.blinds_id.strip() for x in v]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate blinds types are not allowed.")
        return v


@router.get("/lookup/blinds-types", response_model=list[BlindsTypeOptionOut])
def list_blinds_types_for_estimates(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("estimates.view"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    rows = db.execute(
        text(
            """
            SELECT bt.id, bt.name
            FROM blinds_type bt
            INNER JOIN company_blinds_type_matrix m
              ON m.blinds_type_id = bt.id AND m.company_id = CAST(:company_id AS uuid)
            WHERE bt.active IS TRUE
            ORDER BY bt.sort_order ASC, bt.name ASC
            """
        ),
        {"company_id": str(cid)},
    ).mappings().all()
    return [BlindsTypeOptionOut(**dict(r)) for r in rows]


@router.get("/lookup/estimate-statuses", response_model=list[EstimateStatusLookupOptOut])
def list_estimate_statuses_for_estimates(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("estimates.view"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    rows = db.execute(
        text(
            """
            WITH active AS (
              SELECT se.id, se.name, se.sort_order, se.builtin_kind
              FROM status_estimate se
              INNER JOIN company_status_estimate_matrix m
                ON m.status_estimate_id = se.id AND m.company_id = CAST(:cid AS uuid)
              WHERE se.active IS TRUE
            ),
            chosen_builtin AS (
              SELECT DISTINCT ON (a.builtin_kind)
                a.id,
                a.name,
                a.sort_order,
                a.builtin_kind AS code
              FROM active a
              WHERE a.builtin_kind IS NOT NULL
              ORDER BY a.builtin_kind, a.sort_order ASC, a.name ASC, a.id ASC
            ),
            custom AS (
              SELECT a.id, a.name, a.sort_order, NULL::text AS code
              FROM active a
              WHERE a.builtin_kind IS NULL
                AND NOT EXISTS (
                  SELECT 1
                  FROM chosen_builtin b
                  WHERE lower(trim(b.name)) = lower(trim(a.name))
                )
            )
            SELECT id, name, sort_order, code FROM chosen_builtin
            UNION ALL
            SELECT id, name, sort_order, code FROM custom
            ORDER BY sort_order ASC, name ASC
            """
        ),
        {"cid": str(cid)},
    ).mappings().all()
    out: list[EstimateStatusLookupOptOut] = []
    for r in rows:
        d = dict(r)
        c = d.get("code")
        d["code"] = str(c).strip().lower() if c else None
        out.append(EstimateStatusLookupOptOut(**d))
    return out


@router.get("/lookup/create-context", response_model=EstimateCreateContextOut)
def estimate_create_context(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("estimates.view"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    comp = db.execute(
        text(
            """
            SELECT name, email
            FROM companies
            WHERE id = CAST(:cid AS uuid) AND is_deleted IS NOT TRUE
            LIMIT 1
            """
        ),
        {"cid": str(cid)},
    ).mappings().first()
    if not comp:
        raise HTTPException(status_code=403, detail="No active company.")
    org_name = (comp.get("name") or "").strip() or "Company"
    org_email = (comp.get("email") or "").strip() or None
    mem_rows = db.execute(
        text(
            """
            SELECT DISTINCT ON (lower(btrim(u.email)))
              btrim(u.email) AS email,
              u.first_name,
              u.last_name
            FROM user_company_memberships m
            JOIN users u ON u.id = m.user_id
            WHERE m.company_id = CAST(:cid AS uuid)
              AND COALESCE(m.is_deleted, FALSE) IS NOT TRUE
              AND COALESCE(u.is_deleted, FALSE) IS NOT TRUE
              AND u.email IS NOT NULL
              AND btrim(u.email) <> ''
            ORDER BY lower(btrim(u.email)), u.first_name, u.last_name, u.email
            """
        ),
        {"cid": str(cid)},
    ).mappings().all()
    guests: list[EstimateGuestOptionOut] = []
    seen: set[str] = set()
    for r in mem_rows:
        em = (r.get("email") or "").strip()
        if not em:
            continue
        key = em.lower()
        if key in seen:
            continue
        seen.add(key)
        fn = (r.get("first_name") or "").strip()
        ln = (r.get("last_name") or "").strip()
        label = f"{fn} {ln}".strip() or em
        guests.append(EstimateGuestOptionOut(email=em, label=label))
    return EstimateCreateContextOut(
        organizer_name=org_name,
        organizer_email=org_email,
        guest_options=sorted(guests, key=lambda g: g.label.lower()),
    )


@router.get("", response_model=list[EstimateListItemOut])
def list_estimates(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("estimates.view"))],
    limit: int = Query(200, ge=1, le=500),
    search: str | None = Query(None, max_length=200),
    schedule_filter: str | None = Query(None, description="all | upcoming | past"),
    status_esti_id: str | None = Query(None, max_length=16, description="Filter by lookup row id (same as order list)."),
    status_filter: str | None = Query(
        None,
        description="Deprecated: use status_esti_id. If set without status_esti_id: new|pending|converted|cancelled.",
    ),
    customer_id: str | None = Query(None, max_length=16),
    include_deleted: bool = Query(False),
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    sf_raw = (schedule_filter or "all").strip().lower()
    if sf_raw not in ("all", "upcoming", "past"):
        sf_raw = "all"
    st_raw = (status_filter or "all").strip().lower()
    if st_raw not in ("all", "new", "pending", "converted", "cancelled"):
        st_raw = "all"
    sid = (status_esti_id or "").strip()
    term = (search or "").strip()
    where = ["e.company_id = :company_id"]
    if not include_deleted:
        where.append("e.is_deleted IS NOT TRUE")
    params: dict[str, Any] = {"company_id": str(cid), "limit": limit}
    if sf_raw == "upcoming":
        where.append("COALESCE(e.scheduled_start_at, e.tarih_saat) >= NOW()")
    elif sf_raw == "past":
        where.append(
            "COALESCE(e.scheduled_start_at, e.tarih_saat) IS NOT NULL "
            "AND COALESCE(e.scheduled_start_at, e.tarih_saat) < NOW()"
        )
    cust = (customer_id or "").strip()
    if cust:
        params["cust_id"] = cust
        where.append("e.customer_id = :cust_id")
    if sid:
        params["status_esti_id"] = sid
        where.append("e.status_esti_id = :status_esti_id")
    elif st_raw != "all":
        params["st"] = st_raw
        where.append("se.builtin_kind = :st")
    if term:
        params["term"] = f"%{term}%"
        where.append(
            "("
            "COALESCE(c.name,'') ILIKE :term OR COALESCE(c.surname,'') ILIKE :term OR "
            "COALESCE(c.address,'') ILIKE :term OR "
            "COALESCE(e.prospect_name,'') ILIKE :term OR COALESCE(e.prospect_surname,'') ILIKE :term OR "
            "COALESCE(e.prospect_phone,'') ILIKE :term OR COALESCE(e.prospect_email,'') ILIKE :term OR "
            "COALESCE(e.prospect_address,'') ILIKE :term OR "
            "EXISTS ("
            "  SELECT 1 FROM estimate_blinds eb2"
            "  JOIN blinds_type btx ON btx.id = eb2.blinds_id"
            "  WHERE eb2.company_id = e.company_id AND eb2.estimate_id = e.id AND btx.name ILIKE :term"
            ") OR "
            "EXISTS ("
            "  SELECT 1 FROM blinds_type bty"
            "  WHERE bty.id = e.blinds_id AND bty.name ILIKE :term"
            "))"
        )
    where_sql = " AND ".join(where)
    rows = db.execute(
        text(
            f"""
            SELECT
              e.company_id,
              e.id,
              e.customer_id,
              COALESCE(
                NULLIF(trim(concat_ws(' ', c.name, c.surname)), ''),
                NULLIF(trim(concat_ws(' ', e.prospect_name, e.prospect_surname)), ''),
                'Prospect'
              ) AS customer_display,
              COALESCE(c.address, e.prospect_address) AS customer_address,
              COALESCE(c.postal_code, e.prospect_postal_code) AS customer_postal_code,
              ( {_SQL_BLINDS_TYPES_JSON} ) AS blinds_types_json,
              e.perde_sayisi,
              se.builtin_kind AS status,
              COALESCE(NULLIF(trim(se.name), ''), '—') AS status_label,
              e.status_esti_id AS status_esti_id,
              e.is_deleted,
              e.scheduled_start_at,
              e.tarih_saat,
              e.created_at,
              (
                SELECT o.id
                FROM orders o
                WHERE o.company_id = e.company_id
                  AND o.estimate_id IS NOT NULL
                  AND trim(o.estimate_id) = trim(e.id)
                ORDER BY CASE WHEN o.active IS TRUE THEN 0 ELSE 1 END, o.created_at DESC NULLS LAST
                LIMIT 1
              ) AS linked_order_id
            FROM estimate e
            LEFT JOIN customers c ON c.company_id = e.company_id AND c.id = e.customer_id
            LEFT JOIN status_estimate se ON se.id = e.status_esti_id
            WHERE {where_sql}
            ORDER BY COALESCE(e.scheduled_start_at, e.tarih_saat) DESC NULLS LAST, e.created_at DESC
            LIMIT :limit
            """
        ),
        params,
    ).mappings().all()
    return [
        EstimateListItemOut(
            blinds_types=[EstimateBlindsLineOut(**x) for x in _normalize_blinds_lines(r["blinds_types_json"])],
            **{k: v for k, v in dict(r).items() if k != "blinds_types_json"},
        )
        for r in rows
    ]


@router.post("", response_model=EstimateDetailOut, status_code=status.HTTP_201_CREATED)
def create_estimate(
    body: EstimateCreateIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("estimates.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")

    if body.scheduled_wall:
        try:
            naive = datetime.strptime(body.scheduled_wall, "%Y-%m-%dT%H:%M")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid scheduled_wall format.")
        try:
            z = ZoneInfo(body.visit_time_zone)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid visit_time_zone.")
        sched = naive.replace(tzinfo=z)
    else:
        sa = body.scheduled_at
        assert sa is not None
        sched = sa
        if sched.tzinfo is None:
            sched = sched.replace(tzinfo=timezone.utc)

    org_email = str(body.visit_organizer_email) if body.visit_organizer_email else None
    guest_json = json.dumps([str(x) for x in body.visit_guest_emails])

    counts = [ln.window_count for ln in body.blinds_lines if ln.window_count is not None]
    estimate_perde = sum(counts) if counts else None

    new_row = db.execute(
        text(
            """
            SELECT se.id
            FROM status_estimate se
            INNER JOIN company_status_estimate_matrix m
              ON m.status_estimate_id = se.id AND m.company_id = CAST(:cid AS uuid)
            WHERE se.builtin_kind = 'new'
            LIMIT 1
            """
        ),
        {"cid": str(cid)},
    ).mappings().first()
    if not new_row:
        ensure_default_estimate_statuses_for_company(db, cid)
        new_row = db.execute(
            text(
                """
                SELECT se.id
                FROM status_estimate se
                INNER JOIN company_status_estimate_matrix m
                  ON m.status_estimate_id = se.id AND m.company_id = CAST(:cid AS uuid)
                WHERE se.builtin_kind = 'new'
                LIMIT 1
                """
            ),
            {"cid": str(cid)},
        ).mappings().first()
    if not new_row:
        raise HTTPException(
            status_code=500,
            detail="Could not resolve default estimate status (new) for this company.",
        )
    new_status_id = str(new_row["id"])

    if body.blinds_lines:
        assert_blinds_types_enabled_for_company(db, cid, [ln.blinds_id for ln in body.blinds_lines])

    for _ in range(5):
        new_id = _new_estimate_id()
        exists = db.execute(
            text("SELECT 1 FROM estimate WHERE company_id = :cid AND id = :id LIMIT 1"),
            {"cid": str(cid), "id": new_id},
        ).first()
        if exists:
            continue
        try:
            cust_sql = (body.customer_id or "").strip() or None
            db.execute(
                text(
                    """
                    INSERT INTO estimate (
                      company_id, id, customer_id, blinds_id, perde_sayisi,
                      tarih_saat, scheduled_start_at, scheduled_end_at,
                      visit_time_zone, visit_address, visit_postal_code, visit_notes,
                      visit_organizer_name, visit_organizer_email, visit_guest_emails,
                      status_esti_id,
                      lead_source,
                      prospect_name, prospect_surname, prospect_phone, prospect_email, prospect_address, prospect_postal_code,
                      created_at, updated_at
                    )
                    VALUES (
                      :company_id, :id, :customer_id, NULL, :perde_sayisi,
                      :sched, :sched, NULL,
                      :vtz, :vaddr, :vpostal, :vnotes,
                      :org_name, :org_email, CAST(:guests AS jsonb),
                      :status_esti_id,
                      :lead_source,
                      :pname, :psurname, :pphone, :pemail, :paddress, :ppostal,
                      NOW(), NOW()
                    )
                    """
                ),
                {
                    "company_id": str(cid),
                    "id": new_id,
                    "customer_id": cust_sql,
                    "perde_sayisi": estimate_perde,
                    "sched": sched,
                    "vtz": body.visit_time_zone,
                    "vaddr": body.visit_address,
                    "vpostal": body.visit_postal_code,
                    "vnotes": body.visit_notes,
                    "org_name": body.visit_organizer_name,
                    "org_email": org_email,
                    "guests": guest_json,
                    "status_esti_id": new_status_id,
                    "lead_source": body.lead_source,
                    "pname": (
                        format_person_name_casing((body.prospect_name or "").strip() or None)
                        if not cust_sql
                        else None
                    ),
                    "psurname": (
                        format_person_name_casing((body.prospect_surname or "").strip() or None)
                        if not cust_sql
                        else None
                    ),
                    "pphone": (body.prospect_phone or "").strip() or None if not cust_sql else None,
                    "pemail": str(body.prospect_email).strip() if body.prospect_email and not cust_sql else None,
                    "paddress": (body.prospect_address or "").strip() or None if not cust_sql else None,
                    "ppostal": (body.prospect_postal_code or "").strip() or None if not cust_sql else None,
                },
            )
            for sort_i, ln in enumerate(body.blinds_lines):
                la = ln.line_amount
                la_val = None
                if la is not None:
                    la_val = float(Decimal(str(la)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
                db.execute(
                    text(
                        """
                        INSERT INTO estimate_blinds (
                          company_id, estimate_id, blinds_id, sort_order, perde_sayisi, line_amount
                        )
                        VALUES (
                          :company_id, :estimate_id, :blinds_id, :sort_order, :perde_sayisi, :line_amount
                        )
                        """
                    ),
                    {
                        "company_id": str(cid),
                        "estimate_id": new_id,
                        "blinds_id": ln.blinds_id.strip(),
                        "sort_order": sort_i,
                        "perde_sayisi": ln.window_count,
                        "line_amount": la_val,
                    },
                )
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=400,
                detail="Invalid customer or blinds type, or blinds type is inactive.",
            )
        try_push_estimate_to_google_calendar(
            db,
            company_id=cid,
            estimate_id=new_id,
            acting_user_id=current_user.id,
        )
        return get_estimate(estimate_id=new_id, db=db, current_user=current_user)

    raise HTTPException(status_code=500, detail="Could not allocate estimate id, try again.")


@router.get("/{estimate_id}", response_model=EstimateDetailOut)
def get_estimate(
    estimate_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("estimates.view"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    row = db.execute(
        text(
            f"""
            SELECT
              e.company_id,
              e.id,
              e.customer_id,
              COALESCE(
                NULLIF(trim(concat_ws(' ', c.name, c.surname)), ''),
                NULLIF(trim(concat_ws(' ', e.prospect_name, e.prospect_surname)), ''),
                'Prospect'
              ) AS customer_display,
              COALESCE(c.address, e.prospect_address) AS customer_address,
              COALESCE(c.postal_code, e.prospect_postal_code) AS customer_postal_code,
              e.prospect_name,
              e.prospect_surname,
              e.prospect_phone,
              e.prospect_email,
              e.prospect_address,
              e.prospect_postal_code,
              ( {_SQL_BLINDS_TYPES_JSON} ) AS blinds_types_json,
              e.perde_sayisi,
              e.scheduled_start_at,
              e.scheduled_end_at,
              e.tarih_saat,
              e.lead_id,
              e.calendar_provider,
              e.google_event_id,
              e.visit_time_zone,
              e.visit_address,
              e.visit_postal_code,
              e.visit_notes,
              e.visit_organizer_name,
              e.visit_organizer_email,
              e.visit_guest_emails,
              e.visit_recurrence_rrule,
              e.lead_source,
              se.builtin_kind AS status,
              COALESCE(NULLIF(trim(se.name), ''), '—') AS status_label,
              e.status_esti_id AS status_esti_id,
              e.is_deleted,
              e.created_at,
              e.updated_at,
              (
                SELECT o.id
                FROM orders o
                WHERE o.company_id = e.company_id
                  AND o.estimate_id IS NOT NULL
                  AND trim(o.estimate_id) = trim(e.id)
                ORDER BY CASE WHEN o.active IS TRUE THEN 0 ELSE 1 END, o.created_at DESC NULLS LAST
                LIMIT 1
              ) AS linked_order_id
            FROM estimate e
            LEFT JOIN customers c ON c.company_id = e.company_id AND c.id = e.customer_id
            LEFT JOIN status_estimate se ON se.id = e.status_esti_id
            WHERE e.company_id = :company_id AND e.id = :id
            LIMIT 1
            """
        ),
        {"company_id": str(cid), "id": estimate_id},
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Estimate not found.")
    d = dict(row)
    bt_raw = d.pop("blinds_types_json", None)
    d["visit_guest_emails"] = _coerce_guest_emails_column(d.get("visit_guest_emails"))
    d["scheduled_wall"] = _scheduled_wall_for_detail(
        d.get("scheduled_start_at"),
        d.get("tarih_saat"),
        d.get("visit_time_zone"),
    )
    return EstimateDetailOut(
        blinds_types=[EstimateBlindsLineOut(**x) for x in _normalize_blinds_lines(bt_raw)],
        **d,
    )


@router.patch("/{estimate_id}", response_model=EstimateDetailOut)
def patch_estimate(
    estimate_id: str,
    payload: EstimatePatchIn,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("estimates.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    eid = estimate_id.strip()
    cur = db.execute(
        text(
            """
            SELECT e.visit_time_zone, e.customer_id, se.builtin_kind AS status_builtin_kind
            FROM estimate e
            LEFT JOIN status_estimate se ON se.id = e.status_esti_id
            WHERE e.company_id = CAST(:cid AS uuid) AND e.id = :eid AND e.is_deleted IS NOT TRUE
            LIMIT 1
            """
        ),
        {"cid": str(cid), "eid": eid},
    ).mappings().first()
    if not cur:
        raise HTTPException(status_code=404, detail="Estimate not found.")
    has_customer = bool((cur.get("customer_id") or "").strip())

    sets: list[str] = []
    params: dict[str, Any] = {"cid": str(cid), "eid": eid}

    if payload.scheduled_wall is not None:
        tz_use = (payload.visit_time_zone or cur.get("visit_time_zone") or "UTC").strip()
        try:
            z = ZoneInfo(tz_use)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid visit_time_zone.")
        try:
            naive = datetime.strptime(payload.scheduled_wall, "%Y-%m-%dT%H:%M")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid scheduled_wall.")
        sched = naive.replace(tzinfo=z)
        sets.extend(
            [
                "scheduled_start_at = :sched",
                "tarih_saat = :sched",
                "visit_time_zone = :vtz_after_sched",
            ]
        )
        params["sched"] = sched
        params["vtz_after_sched"] = tz_use
    elif payload.visit_time_zone is not None:
        sets.append("visit_time_zone = :vtz")
        params["vtz"] = payload.visit_time_zone

    if payload.visit_notes is not None:
        sets.append("visit_notes = :vnotes")
        params["vnotes"] = payload.visit_notes
    if payload.visit_address is not None:
        sets.append("visit_address = :vaddr")
        params["vaddr"] = payload.visit_address
    if payload.visit_postal_code is not None:
        sets.append("visit_postal_code = :vpostal")
        params["vpostal"] = payload.visit_postal_code
    if payload.visit_organizer_name is not None:
        sets.append("visit_organizer_name = :orgn")
        params["orgn"] = payload.visit_organizer_name
    if payload.visit_organizer_email is not None:
        sets.append("visit_organizer_email = :orge")
        params["orge"] = str(payload.visit_organizer_email)
    if payload.visit_guest_emails is not None:
        sets.append("visit_guest_emails = CAST(:guests AS jsonb)")
        params["guests"] = json.dumps([str(x) for x in payload.visit_guest_emails])

    patch_dump = payload.model_dump(exclude_unset=True)
    if not has_customer:
        if "prospect_name" in patch_dump:
            sets.append("prospect_name = :prospect_name")
            pn = patch_dump["prospect_name"]
            params["prospect_name"] = (
                None if pn is None else format_person_name_casing(str(pn).strip() or None)
            )
        if "prospect_surname" in patch_dump:
            sets.append("prospect_surname = :prospect_surname")
            ps = patch_dump["prospect_surname"]
            params["prospect_surname"] = (
                None if ps is None else format_person_name_casing(str(ps).strip() or None)
            )
        if "prospect_phone" in patch_dump:
            sets.append("prospect_phone = :prospect_phone")
            params["prospect_phone"] = patch_dump["prospect_phone"]
        if "prospect_email" in patch_dump:
            sets.append("prospect_email = :prospect_email")
            pe = patch_dump["prospect_email"]
            params["prospect_email"] = str(pe).strip() if pe else None
        if "prospect_address" in patch_dump:
            sets.append("prospect_address = :prospect_address")
            params["prospect_address"] = patch_dump["prospect_address"]
        if "prospect_postal_code" in patch_dump:
            sets.append("prospect_postal_code = :prospect_postal_code")
            params["prospect_postal_code"] = patch_dump["prospect_postal_code"]

    if "lead_source" in patch_dump:
        sets.append("lead_source = :lead_source")
        params["lead_source"] = patch_dump.get("lead_source")

    if payload.status_esti_id is not None:
        cur_kind_raw = (cur or {}).get("status_builtin_kind")
        cur_kind = str(cur_kind_raw).strip().lower() if cur_kind_raw else None
        if cur_kind == "converted":
            raise HTTPException(
                status_code=400,
                detail=(
                    "This estimate is linked to an order; its status cannot be edited here. "
                    "Cancel the order from the Orders page (remove the order or set order status to Cancelled) "
                    "to set this estimate to Cancelled."
                ),
            )
        new_st = db.execute(
            text(
                """
                SELECT se.id, se.builtin_kind
                FROM status_estimate se
                INNER JOIN company_status_estimate_matrix m
                  ON m.status_estimate_id = se.id AND m.company_id = CAST(:cid AS uuid)
                WHERE se.id = :sid AND se.active IS TRUE
                LIMIT 1
                """
            ),
            {"cid": str(cid), "sid": payload.status_esti_id.strip()},
        ).mappings().first()
        if not new_st:
            raise HTTPException(status_code=400, detail="Invalid estimate status.")
        sets.append("status_esti_id = :sest")
        params["sest"] = str(new_st["id"]).strip()

    if payload.blinds_lines is not None:
        assert_blinds_types_enabled_for_company(db, cid, [ln.blinds_id for ln in payload.blinds_lines])
        counts = [ln.window_count for ln in payload.blinds_lines if ln.window_count is not None]
        estimate_perde = sum(counts) if counts else None
        db.execute(
            text(
                "DELETE FROM estimate_blinds WHERE company_id = CAST(:cid AS uuid) AND estimate_id = :eid"
            ),
            {"cid": str(cid), "eid": eid},
        )
        for sort_i, ln in enumerate(payload.blinds_lines):
            la = ln.line_amount
            la_val = None
            if la is not None:
                la_val = float(Decimal(str(la)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
            db.execute(
                text(
                    """
                    INSERT INTO estimate_blinds (
                      company_id, estimate_id, blinds_id, sort_order, perde_sayisi, line_amount
                    )
                    VALUES (
                      CAST(:cid AS uuid), :estimate_id, :blinds_id, :sort_order, :perde_sayisi, :line_amount
                    )
                    """
                ),
                {
                    "cid": str(cid),
                    "estimate_id": eid,
                    "blinds_id": ln.blinds_id.strip(),
                    "sort_order": sort_i,
                    "perde_sayisi": ln.window_count,
                    "line_amount": la_val,
                },
            )
        sets.append("perde_sayisi = :perde")
        params["perde"] = estimate_perde

    if not sets:
        raise HTTPException(status_code=400, detail="No changes submitted.")

    sets.append("updated_at = NOW()")
    db.execute(
        text(
            f"""
            UPDATE estimate
            SET {", ".join(sets)}
            WHERE company_id = CAST(:cid AS uuid) AND id = :eid AND is_deleted IS NOT TRUE
            """
        ),
        params,
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Invalid blinds type or blinds type is inactive.",
        )
    try_push_estimate_to_google_calendar(
        db,
        company_id=cid,
        estimate_id=eid,
        acting_user_id=current_user.id,
    )
    return get_estimate(estimate_id=eid, db=db, current_user=current_user)


@router.post("/{estimate_id}/restore", response_model=EstimateDetailOut)
def restore_estimate(
    estimate_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("estimates.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    eid = estimate_id.strip()
    res = db.execute(
        text(
            """
            UPDATE estimate
            SET is_deleted = FALSE, updated_at = NOW()
            WHERE company_id = CAST(:cid AS uuid) AND id = :eid AND is_deleted IS TRUE
            """
        ),
        {"cid": str(cid), "eid": eid},
    )
    if res.rowcount != 1:
        raise HTTPException(status_code=404, detail="Estimate not found or not deleted.")
    db.commit()
    return get_estimate(estimate_id=eid, db=db, current_user=current_user)


def _estimate_invoice_number(estimate_id: str) -> str:
    return f"INV-EST-{estimate_id}"


def _sum_estimate_line_amounts(lines: Any) -> Decimal | None:
    if not isinstance(lines, list):
        return None
    total = Decimal("0")
    any_amt = False
    for item in lines:
        if not isinstance(item, dict):
            continue
        v = item.get("line_amount")
        if v is None:
            continue
        try:
            d = Decimal(str(v))
        except Exception:
            continue
        total += d
        any_amt = True
    if not any_amt:
        return None
    return total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _estimate_deposit_pdf_money_fields(total_amt: Decimal | None) -> dict[str, str]:
    """Placeholder business rule: 50% deposit vs balance when line totals exist; avoids bare '$' in PDF."""
    dash = "—"
    if total_amt is None:
        return {
            "total_project_price": dash,
            "deposit_required": dash,
            "balance_remaining": dash,
            "deposit_paid": dash,
        }
    half = (total_amt / Decimal("2")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    remainder = (total_amt - half).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return {
        "total_project_price": f"{total_amt:,.2f}",
        "deposit_required": f"{half:,.2f}",
        "balance_remaining": f"{remainder:,.2f}",
        # Estimates deposit-contract is usually sent before any payment is recorded; show 0.00 for presets that
        # render "payments received" as numeric rows.
        "deposit_paid": "0.00",
    }


def _fetch_estimate_doc_context(db: Session, company_id: UUID, estimate_id: str) -> dict[str, Any] | None:
    row = db.execute(
        text(
            f"""
            SELECT
              e.id::text AS estimate_id,
              e.customer_id,
              trim(concat_ws(' ', c.name, c.surname)) AS customer_name,
              c.address AS customer_address,
              c.phone AS customer_phone,
              c.email AS customer_email,
              e.prospect_name,
              e.prospect_surname,
              e.prospect_phone,
              e.prospect_email,
              e.prospect_address,
              se.builtin_kind AS status_kind,
              { _SQL_BLINDS_TYPES_JSON } AS blinds_types,
              co.name AS company_name,
              co.address AS company_address,
              co.phone AS company_phone,
              co.email AS company_email
            FROM estimate e
            LEFT JOIN customers c ON c.company_id = e.company_id AND c.id = e.customer_id
            LEFT JOIN status_estimate se ON se.id = e.status_esti_id
            JOIN companies co ON co.id = e.company_id
            WHERE e.company_id = CAST(:cid AS uuid) AND e.id = :eid AND e.is_deleted IS NOT TRUE
            LIMIT 1
            """
        ),
        {"cid": str(company_id), "eid": estimate_id},
    ).mappings().first()
    return dict(row) if row else None


@router.get("/{estimate_id}/documents/deposit-contract")
def estimate_deposit_contract_download(
    estimate_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("estimates.view"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    eid = estimate_id.strip()
    ctx = _fetch_estimate_doc_context(db, cid, eid)
    if not ctx:
        raise HTTPException(status_code=404, detail="Estimate not found.")
    if (str(ctx.get("status_kind") or "")).strip().lower() != "pending":
        raise HTTPException(status_code=400, detail="Deposit invoice + contract is available only for Pending estimates.")

    now = datetime.now(timezone.utc).astimezone()
    inv_no = _estimate_invoice_number(eid)
    cust_name = (str(ctx.get("customer_name") or "")).strip()
    if not cust_name:
        cust_name = f"{(ctx.get('prospect_name') or '').strip()} {(ctx.get('prospect_surname') or '').strip()}".strip()
    cust_addr = (str(ctx.get("customer_address") or "")).strip() or (str(ctx.get("prospect_address") or "")).strip()
    cust_phone = (str(ctx.get("customer_phone") or "")).strip() or (str(ctx.get("prospect_phone") or "")).strip()

    lines = ctx.get("blinds_types")
    if isinstance(lines, str):
        try:
            lines = json.loads(lines)
        except json.JSONDecodeError:
            lines = []
    total_amt = _sum_estimate_line_amounts(lines)
    money = _estimate_deposit_pdf_money_fields(total_amt)

    _subj, pdf = render_contract_invoice_pdf(
        db=db,
        company_id=str(cid),
        kind="deposit_contract",
        page_title="Invoice & Service Agreement",
        data={
            "business_name": (str(ctx.get("company_name") or "")).strip(),
            "business_address": (str(ctx.get("company_address") or "")).strip(),
            "business_phone": (str(ctx.get("company_phone") or "")).strip(),
            "business_email": (str(ctx.get("company_email") or "")).strip(),
            "customer_name": cust_name,
            "customer_address": cust_addr,
            "customer_phone": cust_phone,
            "invoice_number": inv_no,
            "invoice_date": now.strftime("%b %d, %Y"),
            "product": "Custom Zebra Blinds",
            "description": "",
            "measurements": "",
            "installation_address": cust_addr,
            **money,
            "extra_payments_total": "0.00",
            "extra_payments_count": "0 payments",
            "payments_received_total": money.get("deposit_paid", "0.00") or "0.00",
            "payment_method": "—",
            "payment_date": "—",
        },
    )
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="deposit-invoice-contract-{eid}.pdf"'},
    )


@router.post("/{estimate_id}/documents/deposit-contract/send-email", status_code=status.HTTP_204_NO_CONTENT)
def estimate_deposit_contract_send_email(
    estimate_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("estimates.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    eid = estimate_id.strip()
    ctx = _fetch_estimate_doc_context(db, cid, eid)
    if not ctx:
        raise HTTPException(status_code=404, detail="Estimate not found.")
    if (str(ctx.get("status_kind") or "")).strip().lower() != "pending":
        raise HTTPException(status_code=400, detail="Deposit invoice + contract is available only for Pending estimates.")

    to_email = (str(ctx.get("customer_email") or "")).strip() or (str(ctx.get("prospect_email") or "")).strip()
    if not to_email:
        raise HTTPException(status_code=400, detail="Customer email is missing for this estimate.")

    now = datetime.now(timezone.utc).astimezone()
    inv_no = _estimate_invoice_number(eid)
    cust_name = (str(ctx.get("customer_name") or "")).strip()
    if not cust_name:
        cust_name = f"{(ctx.get('prospect_name') or '').strip()} {(ctx.get('prospect_surname') or '').strip()}".strip()
    cust_addr = (str(ctx.get("customer_address") or "")).strip() or (str(ctx.get("prospect_address") or "")).strip()
    cust_phone = (str(ctx.get("customer_phone") or "")).strip() or (str(ctx.get("prospect_phone") or "")).strip()

    lines = ctx.get("blinds_types")
    if isinstance(lines, str):
        try:
            lines = json.loads(lines)
        except json.JSONDecodeError:
            lines = []
    total_amt = _sum_estimate_line_amounts(lines)
    money = _estimate_deposit_pdf_money_fields(total_amt)

    subject, pdf = render_contract_invoice_pdf(
        db=db,
        company_id=str(cid),
        kind="deposit_contract",
        page_title="Invoice & Service Agreement",
        data={
            "business_name": (str(ctx.get("company_name") or "")).strip(),
            "business_address": (str(ctx.get("company_address") or "")).strip(),
            "business_phone": (str(ctx.get("company_phone") or "")).strip(),
            "business_email": (str(ctx.get("company_email") or "")).strip(),
            "customer_name": cust_name,
            "customer_address": cust_addr,
            "customer_phone": cust_phone,
            "invoice_number": inv_no,
            "invoice_date": now.strftime("%b %d, %Y"),
            "product": "Custom Zebra Blinds",
            "description": "",
            "measurements": "",
            "installation_address": cust_addr,
            **money,
            "extra_payments_total": "0.00",
            "extra_payments_count": "0 payments",
            "payments_received_total": money.get("deposit_paid", "0.00") or "0.00",
            "payment_method": "—",
            "payment_date": "—",
        },
    )

    ok = send_html_email(
        to_email=to_email,
        subject=subject,
        html="<p>Please see the attached invoice &amp; service agreement.</p>",
        text="Please see the attached invoice & service agreement.",
        attachments=[(f"deposit-invoice-contract-{eid}.pdf", pdf, "application/pdf")],
    )
    if not ok:
        raise HTTPException(status_code=500, detail="Email could not be sent (SMTP not configured or failed).")
    return None


@router.delete("/{estimate_id}", status_code=status.HTTP_204_NO_CONTENT)
def soft_delete_estimate(
    estimate_id: str,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[Users, Depends(require_permissions("estimates.edit"))],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    res = db.execute(
        text(
            """
            UPDATE estimate
            SET is_deleted = TRUE, updated_at = NOW()
            WHERE company_id = :company_id AND id = :id AND is_deleted IS NOT TRUE
            """
        ),
        {"company_id": str(cid), "id": estimate_id.strip()},
    )
    if res.rowcount != 1:
        raise HTTPException(status_code=404, detail="Estimate not found.")
    db.commit()
