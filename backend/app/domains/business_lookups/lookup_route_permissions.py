"""Granular lookup route permissions; legacy ``lookups.view`` / ``lookups.edit`` still accepted."""

from __future__ import annotations

from typing import Literal

from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.authorization import has_permission
from app.core.database import get_db
from app.dependencies.auth import get_current_user
from app.domains.user.models.users import Users

LEGACY_LOOKUP_VIEW = "lookups.view"
LEGACY_LOOKUP_EDIT = "lookups.edit"

LOOKUPS_KIND_EXTRA_VIEW_KEYS = (LEGACY_LOOKUP_VIEW,)


def _extra_option_keys_for_kind(_kind_id: str, mode: Literal["view", "edit"]) -> tuple[str, ...]:
    return (LEGACY_LOOKUP_VIEW,) if mode == "view" else (LEGACY_LOOKUP_EDIT,)


def require_lookup_extra_options(mode: Literal["view", "edit"]):
    """Path must include ``kind_id`` (same name as route param)."""

    def _dep(
        kind_id: str,
        db: Session = Depends(get_db),
        current_user: Users = Depends(get_current_user),
    ) -> Users:
        active = getattr(current_user, "active_role", None)
        for key in _extra_option_keys_for_kind(kind_id, mode):
            if has_permission(db, current_user.id, key, active_role=active):
                return current_user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Requires blinds extra options permission for this attribute.",
        )

    return _dep
