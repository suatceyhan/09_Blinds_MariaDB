"""PostgreSQL session GUC'ları ile RLS bağlamı (DB/03_migrate_tenant_rls.sql).

MariaDB/MySQL bağlantılarında no-op; kiracı filtresi uygulama katmanında kalır.

Bağlantı havuzunda sızıntı olmaması için get_db finally içinde sıfırlanır.
"""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import settings
from app.domains.user.models.users import Users


def _is_postgres(db: Session) -> bool:
    bind = db.get_bind()
    return bind is not None and bind.dialect.name == "postgresql"


def reset_connection_rls_gucs(db: Session) -> None:
    """Havuzdan gelen bağlantıyı güvenli varsayılan: bypass (bootstrap, login, public)."""
    if not _is_postgres(db) or not settings.tenant_rls_enabled:
        return
    db.execute(text("SELECT set_config('app.rls_bypass', '1', false)"))
    db.execute(text("SELECT set_config('app.tenant_company_id', '', false)"))
    db.execute(text("SELECT set_config('app.current_user_id', '', false)"))


def refresh_tenant_rls_context(
    db: Session,
    user: Users,
    active_company_id: Optional[UUID],
    active_role: Optional[str] = None,
) -> None:
    """JWT veya switch-company sonrası kiracı bağlamını DB oturumuna yazar."""
    from app.core.authorization import is_effective_superadmin

    if not _is_postgres(db) or not settings.tenant_rls_enabled:
        return

    if is_effective_superadmin(db, user.id, active_role):
        db.execute(text("SELECT set_config('app.rls_bypass', '1', false)"))
        db.execute(text("SELECT set_config('app.tenant_company_id', '', false)"))
        db.execute(text("SELECT set_config('app.current_user_id', '', false)"))
        return

    db.execute(text("SELECT set_config('app.rls_bypass', '0', false)"))
    tenant = str(active_company_id) if active_company_id else ""
    db.execute(
        text("SELECT set_config('app.tenant_company_id', :tenant, false)"),
        {"tenant": tenant},
    )
    db.execute(
        text("SELECT set_config('app.current_user_id', :uid, false)"),
        {"uid": str(user.id)},
    )
