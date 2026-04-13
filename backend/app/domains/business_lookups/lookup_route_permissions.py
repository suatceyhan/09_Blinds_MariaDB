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

LOOKUPS_KIND_EXTRA_VIEW_KEYS = (
    "lookups.blinds_extra_lifting_system.view",
    "lookups.blinds_extra_cassette_type.view",
    LEGACY_LOOKUP_VIEW,
)


def _extra_option_keys_for_kind(kind_id: str, mode: Literal["view", "edit"]) -> tuple[str, ...]:
    kid = (kind_id or "").strip()
    if mode == "view":
        if kid == "lifting_system":
            return ("lookups.blinds_extra_lifting_system.view", LEGACY_LOOKUP_VIEW)
        if kid == "cassette_type":
            return ("lookups.blinds_extra_cassette_type.view", LEGACY_LOOKUP_VIEW)
        return (LEGACY_LOOKUP_VIEW,)
    if kid == "lifting_system":
        return ("lookups.blinds_extra_lifting_system.edit", LEGACY_LOOKUP_EDIT)
    if kid == "cassette_type":
        return ("lookups.blinds_extra_cassette_type.edit", LEGACY_LOOKUP_EDIT)
    return (LEGACY_LOOKUP_EDIT,)


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
