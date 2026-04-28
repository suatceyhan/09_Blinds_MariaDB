"""Backward-compatible re-exports for company onboarding (matrix + global catalog seed)."""

from app.domains.business_lookups.services.global_status_seed import (  # noqa: F401
    ensure_default_estimate_statuses_for_company,
    ensure_global_catalog_seeded,
)
