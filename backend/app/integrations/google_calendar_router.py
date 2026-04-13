from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing_extensions import Annotated

from app.core.config import settings
from app.core.database import get_db
from app.dependencies.auth import effective_company_id, require_permissions
from app.domains.user.models.users import Users
from app.integrations.google_calendar_service import (
    build_authorization_url,
    complete_oauth_callback,
    create_oauth_state_token,
    delete_company_google_calendar,
    get_connection_status,
    google_calendar_oauth_configured,
)

router = APIRouter(prefix="/integrations/google", tags=["Google Calendar"])
logger = logging.getLogger(__name__)


class GoogleCalendarAuthUrlOut(BaseModel):
    authorization_url: str


class GoogleCalendarStatusOut(BaseModel):
    connected: bool
    google_account_email: str | None = None
    calendar_id: str | None = None


def _frontend_integrations_url(query: dict[str, str] | None = None) -> str:
    base = settings.frontend_url.rstrip("/")
    path = f"{base}/settings/integrations"
    if not query:
        return path
    from urllib.parse import urlencode

    return f"{path}?{urlencode(query)}"


@router.get("/authorization-url", response_model=GoogleCalendarAuthUrlOut)
def get_google_calendar_authorization_url(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[
        Users, Depends(require_permissions("companies.edit", "settings.integrations.edit"))
    ],
):
    if not google_calendar_oauth_configured():
        raise HTTPException(
            status_code=503,
            detail="Google Calendar OAuth is not configured on the server.",
        )
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    state = create_oauth_state_token(user_id=current_user.id, company_id=cid)
    url = build_authorization_url(state_token=state)
    return GoogleCalendarAuthUrlOut(authorization_url=url)


@router.get("/callback")
def google_calendar_oauth_callback(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    if error:
        return RedirectResponse(_frontend_integrations_url({"google_calendar": "denied"}))
    if not code or not state:
        return RedirectResponse(_frontend_integrations_url({"google_calendar": "error"}))
    try:
        complete_oauth_callback(
            db,
            authorization_response_url=str(request.url),
            state=state,
        )
    except ValueError as e:
        if e.args and e.args[0] == "calendar_scope_not_granted":
            return RedirectResponse(
                _frontend_integrations_url({"google_calendar": "calendar_scope"})
            )
        return RedirectResponse(_frontend_integrations_url({"google_calendar": "error"}))
    except Exception:
        logger.exception("Google Calendar OAuth callback failed")
        return RedirectResponse(_frontend_integrations_url({"google_calendar": "error"}))
    return RedirectResponse(_frontend_integrations_url({"google_calendar": "connected"}))


@router.get("/status", response_model=GoogleCalendarStatusOut)
def google_calendar_status(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[
        Users, Depends(require_permissions("companies.view", "settings.integrations.view"))
    ],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    raw: dict[str, Any] = get_connection_status(
        db, company_id=cid, user_id=current_user.id
    )
    return GoogleCalendarStatusOut(**raw)


@router.delete("/connection", status_code=204)
def disconnect_google_calendar(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[
        Users, Depends(require_permissions("companies.edit", "settings.integrations.edit"))
    ],
):
    cid = effective_company_id(current_user)
    if not cid:
        raise HTTPException(status_code=403, detail="No active company.")
    delete_company_google_calendar(db, company_id=cid, user_id=current_user.id)
