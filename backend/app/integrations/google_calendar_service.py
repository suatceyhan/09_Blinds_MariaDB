from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from urllib.parse import urlparse, urlunparse
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from typing import Any
from uuid import UUID

from google.auth.transport.requests import Request as GoogleAuthRequest
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from sqlalchemy import text
from sqlalchemy.engine import Dialect
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import create_access_token, decode_token
from app.core.tenant_rls import reset_connection_rls_gucs
from app.domains.user.models.users import Users
from app.domains.user.services.company_membership import user_has_membership

logger = logging.getLogger(__name__)


def _configure_oauthlib_env_for_google_callback() -> None:
    """Local http redirect + Google often returns a subset of requested scopes; oauthlib otherwise errors."""
    raw = (settings.google_oauth_redirect_uri or "").strip()
    if raw:
        p = urlparse(raw.lower())
        if p.scheme == "http":
            host = (p.hostname or "").lower()
            if host in ("localhost", "127.0.0.1") or host == "::1":
                os.environ["OAUTHLIB_INSECURE_TRANSPORT"] = "1"
    os.environ["OAUTHLIB_RELAX_TOKEN_SCOPE"] = "1"


GOOGLE_CAL_SCOPES: list[str] = [
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/userinfo.email",
    "openid",
]


def google_calendar_oauth_configured() -> bool:
    cid = (settings.google_oauth_client_id or "").strip()
    sec = (settings.google_oauth_client_secret or "").strip()
    return bool(cid and sec)


def _client_config() -> dict[str, Any]:
    return {
        "web": {
            "client_id": settings.google_oauth_client_id.strip(),
            "client_secret": settings.google_oauth_client_secret.strip(),
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
            "redirect_uris": [settings.google_oauth_redirect_uri.strip()],
        }
    }


def build_authorization_url(*, state_token: str) -> str:
    # Stateless callback uses a new Flow; PKCE verifier would be lost — off for confidential web client.
    flow = Flow.from_client_config(
        _client_config(),
        scopes=GOOGLE_CAL_SCOPES,
        redirect_uri=settings.google_oauth_redirect_uri.strip(),
        autogenerate_code_verifier=False,
    )
    url, _st = flow.authorization_url(
        access_type="offline",
        prompt="consent",
        state=state_token,
    )
    return url


def create_oauth_state_token(*, user_id: UUID, company_id: UUID) -> str:
    return create_access_token(
        data={
            "user_id": str(user_id),
            "typ": "google_cal",
            "company_id": str(company_id),
        },
        expires_delta=600,
    )


def _canonical_authorization_response_url(authorization_response_url: str) -> str:
    """Token exchange requires redirect_uri to match Flow; Host can differ (localhost vs 127.0.0.1)."""
    req = urlparse(authorization_response_url)
    cfg = urlparse(settings.google_oauth_redirect_uri.strip())
    if not cfg.scheme or not cfg.netloc or not cfg.path:
        return authorization_response_url
    return urlunparse((cfg.scheme, cfg.netloc, cfg.path, "", req.query, req.fragment))


def _user_may_link_company_calendar(db: Session, user_id: UUID, company_id: UUID) -> bool:
    if user_has_membership(db, user_id, company_id):
        return True
    u = db.query(Users).filter(Users.id == user_id, Users.is_deleted.is_(False)).first()
    return u is not None and u.company_id is not None and u.company_id == company_id


def _decode_oauth_state(state: str) -> tuple[UUID, UUID]:
    payload = decode_token(state, db=None, revoked_model=None)
    if not payload or payload.get("typ") != "google_cal":
        raise ValueError("invalid_state")
    uid = payload.get("user_id")
    cid = payload.get("company_id")
    if uid is None or cid is None:
        raise ValueError("invalid_state")
    return UUID(str(uid)), UUID(str(cid))


def _fetch_google_account_email(access_token: str) -> str | None:
    req = urllib.request.Request(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.load(resp)
    except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError, TimeoutError):
        return None
    email = data.get("email")
    return str(email).strip() if email else None


def _set_rls_for_company_user(db: Session, company_id: UUID, user_id: UUID) -> None:
    bind = db.get_bind()
    dialect: Dialect | None = getattr(bind, "dialect", None) if bind else None
    if not settings.tenant_rls_enabled or dialect is None or dialect.name != "postgresql":
        return
    db.execute(text("SELECT set_config('app.rls_bypass', '0', false)"))
    db.execute(
        text("SELECT set_config('app.tenant_company_id', :t, false)"),
        {"t": str(company_id)},
    )
    db.execute(
        text("SELECT set_config('app.current_user_id', :u, false)"),
        {"u": str(user_id)},
    )


def complete_oauth_callback(db: Session, *, authorization_response_url: str, state: str) -> None:
    user_id, company_id = _decode_oauth_state(state)
    if not _user_may_link_company_calendar(db, user_id, company_id):
        raise ValueError("membership")

    _configure_oauthlib_env_for_google_callback()

    auth_url = _canonical_authorization_response_url(authorization_response_url)

    flow = Flow.from_client_config(
        _client_config(),
        scopes=GOOGLE_CAL_SCOPES,
        state=state,
        redirect_uri=settings.google_oauth_redirect_uri.strip(),
        autogenerate_code_verifier=False,
    )
    flow.fetch_token(authorization_response=auth_url)
    creds = flow.credentials
    token_scope_raw = flow.oauth2session.token.get("scope") or ""
    if isinstance(token_scope_raw, str):
        granted_scopes = set(token_scope_raw.split())
    else:
        granted_scopes = set(token_scope_raw or [])
    cal_events = "https://www.googleapis.com/auth/calendar.events"
    if cal_events not in granted_scopes:
        raise ValueError("calendar_scope_not_granted")
    rt = creds.refresh_token
    access = creds.token or ""
    email = _fetch_google_account_email(access) if access else None

    reset_connection_rls_gucs(db)
    _set_rls_for_company_user(db, company_id, user_id)

    if rt:
        db.execute(
            text(
                """
                INSERT INTO company_google_calendar (
                  company_id, refresh_token, calendar_id, google_account_email, created_at, updated_at
                )
                VALUES (
                  CAST(:company_id AS uuid), :refresh_token, 'primary', :google_account_email, NOW(), NOW()
                )
                ON CONFLICT (company_id) DO UPDATE SET
                  refresh_token = EXCLUDED.refresh_token,
                  google_account_email = COALESCE(
                    EXCLUDED.google_account_email,
                    company_google_calendar.google_account_email
                  ),
                  updated_at = NOW()
                """
            ),
            {
                "company_id": str(company_id),
                "refresh_token": rt,
                "google_account_email": email,
            },
        )
    else:
        prev = db.execute(
            text(
                """
                SELECT refresh_token FROM company_google_calendar
                WHERE company_id = CAST(:cid AS uuid)
                LIMIT 1
                """
            ),
            {"cid": str(company_id)},
        ).scalar()
        if not prev:
            raise ValueError("no_refresh_token")
        if email:
            db.execute(
                text(
                    """
                    UPDATE company_google_calendar
                    SET google_account_email = :email, updated_at = NOW()
                    WHERE company_id = CAST(:cid AS uuid)
                    """
                ),
                {"cid": str(company_id), "email": email},
            )
    db.commit()
    reset_connection_rls_gucs(db)


def delete_company_google_calendar(db: Session, *, company_id: UUID, user_id: UUID) -> bool:
    reset_connection_rls_gucs(db)
    _set_rls_for_company_user(db, company_id, user_id)
    res = db.execute(
        text(
            "DELETE FROM company_google_calendar WHERE company_id = CAST(:cid AS uuid)"
        ),
        {"cid": str(company_id)},
    )
    db.commit()
    reset_connection_rls_gucs(db)
    return (res.rowcount or 0) > 0


def get_connection_status(
    db: Session, *, company_id: UUID, user_id: UUID
) -> dict[str, Any]:
    reset_connection_rls_gucs(db)
    _set_rls_for_company_user(db, company_id, user_id)
    row = db.execute(
        text(
            """
            SELECT google_account_email, calendar_id, updated_at
            FROM company_google_calendar
            WHERE company_id = CAST(:cid AS uuid)
            LIMIT 1
            """
        ),
        {"cid": str(company_id)},
    ).mappings().first()
    reset_connection_rls_gucs(db)
    if not row:
        return {"connected": False, "google_account_email": None, "calendar_id": None}
    return {
        "connected": True,
        "google_account_email": row.get("google_account_email"),
        "calendar_id": row.get("calendar_id"),
    }


def _coerce_json_email_list(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()]
    if isinstance(raw, str):
        try:
            j = json.loads(raw)
            return [str(x).strip() for x in j] if isinstance(j, list) else []
        except json.JSONDecodeError:
            return []
    return []


def _google_event_start_end(
    start_dt: datetime, end_dt: datetime, tz_name: str | None
) -> tuple[dict[str, str], dict[str, str]]:
    name = (tz_name or "").strip() or "UTC"
    try:
        z = ZoneInfo(name)
    except Exception:
        z = ZoneInfo("UTC")
        name = "UTC"
    s = start_dt if start_dt.tzinfo else start_dt.replace(tzinfo=timezone.utc)
    e = end_dt if end_dt.tzinfo else end_dt.replace(tzinfo=timezone.utc)
    s = s.astimezone(z)
    e = e.astimezone(z)
    tz_key = getattr(z, "key", None) or name
    return (
        {"dateTime": s.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": tz_key},
        {"dateTime": e.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": tz_key},
    )


def _calendar_credentials(refresh_token: str) -> Credentials:
    return Credentials(
        token=None,
        refresh_token=refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.google_oauth_client_id.strip(),
        client_secret=settings.google_oauth_client_secret.strip(),
        scopes=GOOGLE_CAL_SCOPES,
    )


def try_push_estimate_to_google_calendar(
    db: Session, *, company_id: UUID, estimate_id: str, acting_user_id: UUID
) -> None:
    if not google_calendar_oauth_configured():
        return
    try:
        reset_connection_rls_gucs(db)
        _set_rls_for_company_user(db, company_id, acting_user_id)
        cal_row = db.execute(
            text(
                """
                SELECT refresh_token, calendar_id, google_account_email
                FROM company_google_calendar
                WHERE company_id = CAST(:cid AS uuid)
                LIMIT 1
                """
            ),
            {"cid": str(company_id)},
        ).mappings().first()
        if not cal_row:
            reset_connection_rls_gucs(db)
            return

        est = db.execute(
            text(
                """
                SELECT
                  e.id,
                  e.scheduled_start_at,
                  e.tarih_saat,
                  se.builtin_kind AS status,
                  e.google_event_id,
                  e.visit_time_zone,
                  e.visit_address,
                  e.visit_notes,
                  e.visit_organizer_name,
                  e.visit_organizer_email,
                  e.visit_guest_emails,
                  e.visit_recurrence_rrule,
                  COALESCE(
                    NULLIF(trim(concat_ws(' ', c.name, c.surname)), ''),
                    NULLIF(trim(concat_ws(' ', e.prospect_name, e.prospect_surname)), ''),
                    'Prospect'
                  ) AS customer_display,
                  COALESCE(c.address, e.prospect_address) AS customer_address,
                  COALESCE(c.phone, e.prospect_phone) AS customer_phone
                FROM estimate e
                LEFT JOIN customers c ON c.company_id = e.company_id AND c.id = e.customer_id
                LEFT JOIN status_estimate se ON se.id = e.status_esti_id
                WHERE e.company_id = CAST(:cid AS uuid) AND e.id = :eid AND e.is_deleted IS NOT TRUE
                LIMIT 1
                """
            ),
            {"cid": str(company_id), "eid": estimate_id},
        ).mappings().first()
        if not est:
            reset_connection_rls_gucs(db)
            return

        raw_status = est.get("status")
        st = str(raw_status).strip().lower() if raw_status is not None and str(raw_status).strip() else ""
        if st == "cancelled":
            reset_connection_rls_gucs(db)
            return

        line_rows = db.execute(
            text(
                """
                SELECT bt.name AS name, eb.perde_sayisi AS window_count
                FROM estimate_blinds eb
                JOIN blinds_type bt ON bt.id = eb.blinds_id
                WHERE eb.company_id = CAST(:cid AS uuid) AND eb.estimate_id = :eid
                ORDER BY eb.sort_order, bt.name
                """
            ),
            {"cid": str(company_id), "eid": estimate_id},
        ).mappings().all()
        desc_lines: list[str] = []
        for lr in line_rows:
            wc = lr.get("window_count")
            wtxt = f" ({wc} windows)" if wc is not None else ""
            desc_lines.append(f"{lr['name']}{wtxt}")
        if not desc_lines:
            legacy = db.execute(
                text(
                    """
                    SELECT bt.name AS name, e.perde_sayisi AS window_count
                    FROM estimate e
                    JOIN blinds_type bt ON bt.id = e.blinds_id
                    WHERE e.company_id = CAST(:cid AS uuid) AND e.id = :eid AND e.is_deleted IS NOT TRUE
                    LIMIT 1
                    """
                ),
                {"cid": str(company_id), "eid": estimate_id},
            ).mappings().first()
            if legacy:
                wc = legacy.get("window_count")
                wtxt = f" ({wc} windows)" if wc is not None else ""
                desc_lines.append(f"{legacy['name']}{wtxt}")

        blinds_block = "\n".join(f"- {ln}" for ln in desc_lines) if desc_lines else "—"
        user_notes = (est.get("visit_notes") or "").strip()
        customer_display = (est.get("customer_display") or "Customer").strip()
        phone = (est.get("customer_phone") or "").strip()
        desc_parts: list[str] = ["Blinds:", blinds_block]
        if phone:
            desc_parts.extend(["", f"Phone: {phone}"])
        if user_notes:
            desc_parts.extend(["", f"Note: {user_notes}"])
        description = "\n".join(desc_parts)

        start_dt = est.get("scheduled_start_at") or est.get("tarih_saat")
        if start_dt is None:
            reset_connection_rls_gucs(db)
            return
        if getattr(start_dt, "tzinfo", None) is None:
            start_dt = start_dt.replace(tzinfo=timezone.utc)
        end_dt = start_dt + timedelta(hours=1)

        creds = _calendar_credentials(cal_row["refresh_token"])
        creds.refresh(GoogleAuthRequest())
        cal_id = (cal_row.get("calendar_id") or "primary").strip() or "primary"
        service = build("calendar", "v3", credentials=creds, cache_discovery=False)
        tz_name = est.get("visit_time_zone")
        start_payload, end_payload = _google_event_start_end(start_dt, end_dt, tz_name if isinstance(tz_name, str) else None)
        safe_name = customer_display.replace('"', "'")
        body: dict[str, Any] = {
            "summary": f'Estimate for "{safe_name}"',
            "description": description,
            "start": start_payload,
            "end": end_payload,
        }
        visit_addr = (est.get("visit_address") or "").strip()
        addr = visit_addr or est.get("customer_address")
        if addr:
            body["location"] = str(addr).strip()
        # Calendar owner (OAuth / company_google_calendar) is the event organizer.
        # Invite only the assigned worker(s) from visit_guest_emails — not the customer,
        # and not the company organizer row (usually same as the connected account).
        attendees_emails: list[str] = []
        owner_email = (cal_row.get("google_account_email") or "").strip().lower()
        for g in _coerce_json_email_list(est.get("visit_guest_emails")):
            gl = g.strip().lower()
            if not gl or gl in attendees_emails:
                continue
            if owner_email and gl == owner_email:
                continue
            attendees_emails.append(gl)
        if attendees_emails:
            body["attendees"] = [{"email": e} for e in attendees_emails]
        rrule = est.get("visit_recurrence_rrule")
        if isinstance(rrule, str) and rrule.strip():
            r = rrule.strip()
            if not r.upper().startswith("RRULE:"):
                r = f"RRULE:{r}"
            body["recurrence"] = [r]

        existing_geid = est.get("google_event_id")
        existing_geid_s = str(existing_geid).strip() if existing_geid else ""

        if existing_geid_s:
            service.events().update(
                calendarId=cal_id,
                eventId=existing_geid_s,
                body=body,
            ).execute()
            db.execute(
                text(
                    """
                    UPDATE estimate
                    SET calendar_last_synced_at = NOW(),
                        updated_at = NOW()
                    WHERE company_id = CAST(:cid AS uuid) AND id = :eid
                    """
                ),
                {"cid": str(company_id), "eid": estimate_id},
            )
            db.commit()
        else:
            ins = (
                service.events()
                .insert(calendarId=cal_id, body=body)
                .execute()
            )
            geid = ins.get("id")
            if geid:
                db.execute(
                    text(
                        """
                        UPDATE estimate
                        SET google_event_id = :geid,
                            calendar_provider = 'google',
                            calendar_last_synced_at = NOW(),
                            updated_at = NOW()
                        WHERE company_id = CAST(:cid AS uuid) AND id = :eid
                        """
                    ),
                    {"geid": geid, "cid": str(company_id), "eid": estimate_id},
                )
                db.commit()
        reset_connection_rls_gucs(db)
    except (HttpError, ProgrammingError, ValueError, KeyError, TypeError):
        logger.exception("Google Calendar sync failed for estimate %s", estimate_id)
        try:
            db.rollback()
        except Exception:
            pass
        reset_connection_rls_gucs(db)


def try_push_order_installation_to_google_calendar(
    db: Session, *, company_id: UUID, order_id: str, acting_user_id: UUID
) -> None:
    """Create/update Google Calendar when installation time is set; delete event when time is cleared or status is cancelled-like."""
    if not google_calendar_oauth_configured():
        return
    try:
        reset_connection_rls_gucs(db)
        _set_rls_for_company_user(db, company_id, acting_user_id)
        cal_row = db.execute(
            text(
                """
                SELECT refresh_token, calendar_id, google_account_email
                FROM company_google_calendar
                WHERE company_id = CAST(:cid AS uuid)
                LIMIT 1
                """
            ),
            {"cid": str(company_id)},
        ).mappings().first()
        if not cal_row:
            reset_connection_rls_gucs(db)
            return

        ord_row = db.execute(
            text(
                """
                SELECT
                  o.installation_scheduled_start_at,
                  o.installation_scheduled_end_at,
                  o.installation_google_event_id,
                  o.blinds_lines,
                  o.status_orde_id,
                  trim(concat_ws(' ', c.name, c.surname)) AS customer_display,
                  c.address AS customer_address
                FROM orders o
                JOIN customers c ON c.company_id = o.company_id AND c.id = o.customer_id
                WHERE o.company_id = CAST(:cid AS uuid) AND o.id = :oid AND o.active IS TRUE
                LIMIT 1
                """
            ),
            {"cid": str(company_id), "oid": order_id},
        ).mappings().first()
        if not ord_row:
            reset_connection_rls_gucs(db)
            return

        sid = ord_row.get("status_orde_id")
        if sid is None or str(sid).strip() == "":
            reset_connection_rls_gucs(db)
            return

        status_nm = ""
        sn_row = db.execute(
            text(
                """
                SELECT lower(trim(so.name)) AS nm
                FROM status_order so
                INNER JOIN company_status_order_matrix m
                  ON m.status_order_id = so.id AND m.company_id = CAST(:cid AS uuid)
                WHERE so.id = :sid AND so.active IS TRUE
                LIMIT 1
                """
            ),
            {"cid": str(company_id), "sid": str(sid).strip()},
        ).mappings().first()
        if sn_row:
            status_nm = str(sn_row.get("nm") or "")
        cancel_like = "cancel" in status_nm

        start_dt_raw = ord_row.get("installation_scheduled_start_at")
        existing_geid_raw = ord_row.get("installation_google_event_id")
        existing_geid_s = str(existing_geid_raw).strip() if existing_geid_raw else ""

        # Remove Google event when installation time is cleared or order is in a cancelled-like status.
        if start_dt_raw is None or cancel_like:
            if existing_geid_s:
                try:
                    creds = _calendar_credentials(cal_row["refresh_token"])
                    creds.refresh(GoogleAuthRequest())
                    cal_id_del = (cal_row.get("calendar_id") or "primary").strip() or "primary"
                    service_del = build("calendar", "v3", credentials=creds, cache_discovery=False)
                    service_del.events().delete(calendarId=cal_id_del, eventId=existing_geid_s).execute()
                    db.execute(
                        text(
                            """
                            UPDATE orders
                            SET installation_google_event_id = NULL,
                                installation_calendar_provider = NULL,
                                installation_calendar_last_synced_at = NOW(),
                                updated_at = NOW()
                            WHERE company_id = CAST(:cid AS uuid) AND id = :oid AND active IS TRUE
                            """
                        ),
                        {"cid": str(company_id), "oid": order_id},
                    )
                    db.commit()
                except HttpError as exc:
                    logger.warning(
                        "Google Calendar delete installation event failed order=%s: %s",
                        order_id,
                        exc,
                    )
                    try:
                        db.rollback()
                    except Exception:
                        pass
            reset_connection_rls_gucs(db)
            return

        start_dt = start_dt_raw
        if getattr(start_dt, "tzinfo", None) is None:
            start_dt = start_dt.replace(tzinfo=timezone.utc)

        end_dt = ord_row.get("installation_scheduled_end_at")
        if end_dt is None:
            end_dt = start_dt + timedelta(hours=1)
        elif getattr(end_dt, "tzinfo", None) is None:
            end_dt = end_dt.replace(tzinfo=timezone.utc)

        desc_lines: list[str] = []
        raw_lines = ord_row.get("blinds_lines")
        if isinstance(raw_lines, str):
            try:
                raw_lines = json.loads(raw_lines)
            except json.JSONDecodeError:
                raw_lines = []
        if isinstance(raw_lines, list):
            for item in raw_lines:
                if not isinstance(item, dict):
                    continue
                nm = (item.get("name") or "").strip()
                if not nm:
                    continue
                wc = item.get("window_count")
                wtxt = f" ({wc} qty)" if wc is not None else ""
                desc_lines.append(f"{nm}{wtxt}")
        blinds_block = "\n".join(f"- {ln}" for ln in desc_lines) if desc_lines else "—"
        customer_display = (ord_row.get("customer_display") or "Customer").strip()
        addr = (ord_row.get("customer_address") or "").strip()
        description = "\n".join(
            [
                f"Order: {order_id}",
                "",
                "Blinds:",
                blinds_block,
                *(["", f"Address: {addr}"] if addr else []),
            ]
        )

        creds = _calendar_credentials(cal_row["refresh_token"])
        creds.refresh(GoogleAuthRequest())
        cal_id = (cal_row.get("calendar_id") or "primary").strip() or "primary"
        service = build("calendar", "v3", credentials=creds, cache_discovery=False)
        tzinfo = start_dt.tzinfo
        tz_name = getattr(tzinfo, "key", None) if tzinfo else None
        if not tz_name:
            tz_name = "UTC"
        start_payload, end_payload = _google_event_start_end(start_dt, end_dt, tz_name)
        safe_name = customer_display.replace('"', "'")
        body: dict[str, Any] = {
            "summary": f'Installation for "{safe_name}"',
            "description": description,
            "start": start_payload,
            "end": end_payload,
        }
        if addr:
            body["location"] = addr

        existing_geid = ord_row.get("installation_google_event_id")
        existing_geid_s = str(existing_geid).strip() if existing_geid else ""

        if existing_geid_s:
            service.events().update(
                calendarId=cal_id,
                eventId=existing_geid_s,
                body=body,
            ).execute()
            db.execute(
                text(
                    """
                    UPDATE orders
                    SET installation_calendar_last_synced_at = NOW(),
                        installation_calendar_provider = 'google',
                        updated_at = NOW()
                    WHERE company_id = CAST(:cid AS uuid) AND id = :oid AND active IS TRUE
                    """
                ),
                {"cid": str(company_id), "oid": order_id},
            )
            db.commit()
        else:
            ins = service.events().insert(calendarId=cal_id, body=body).execute()
            geid = ins.get("id")
            if geid:
                db.execute(
                    text(
                        """
                        UPDATE orders
                        SET installation_google_event_id = :geid,
                            installation_calendar_provider = 'google',
                            installation_calendar_last_synced_at = NOW(),
                            updated_at = NOW()
                        WHERE company_id = CAST(:cid AS uuid) AND id = :oid AND active IS TRUE
                        """
                    ),
                    {"geid": geid, "cid": str(company_id), "oid": order_id},
                )
                db.commit()
        reset_connection_rls_gucs(db)
    except (HttpError, ProgrammingError, ValueError, KeyError, TypeError):
        logger.exception("Google Calendar sync failed for order installation %s", order_id)
        try:
            db.rollback()
        except Exception:
            pass
        reset_connection_rls_gucs(db)
