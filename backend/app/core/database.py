from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, declarative_base, sessionmaker

from app.core.config import settings

Base = declarative_base()


def _connect_args(url: str) -> dict:
    if url.startswith("postgresql"):
        # Havuzdan yeni bağlantı: bootstrap/login RLS'ten muaf (FORCE RLS + owner için gerekli)
        return {"options": "-c app.rls_bypass=1"}
    if url.startswith("mysql"):
        # MariaDB: allow `||` string concatenation in legacy SQL snippets.
        return {"init_command": "SET SESSION sql_mode = CONCAT(@@sql_mode, ',PIPES_AS_CONCAT')"}
    return {}


engine = create_engine(
    settings.database_url,
    echo=False,
    connect_args=_connect_args(settings.database_url),
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _import_all_models() -> None:
    """Users iliskileri (RevokedTokens vb.) mapper kurulumundan once yuklensin."""
    from app.domains.audit.models import (  # noqa: F401
        system_audit_logs,
        user_audit_logs,
    )
    from app.domains.auth.models import (  # noqa: F401
        login_attempts,
        password_reset_tokens,
        revoked_tokens,
        user_sessions,
    )
    from app.domains.customers.models import customers  # noqa: F401
    from app.domains.company.models import company, pending_company_self_registrations  # noqa: F401
    from app.domains.lookup.models import permissions, role_group, roles  # noqa: F401
    from app.domains.user.models import (  # noqa: F401
        pending_employee_self_registrations,
        role_permissions,
        user_company_memberships,
        user_permissions,
        user_roles,
        users,
    )


_import_all_models()


def create_all_tables() -> None:
    _import_all_models()
    Base.metadata.create_all(bind=engine)


def get_db() -> Generator[Session, None, None]:
    from app.core.tenant_rls import reset_connection_rls_gucs

    db = SessionLocal()
    try:
        reset_connection_rls_gucs(db)
        yield db
    finally:
        # Hatalı isteklerde transaction "aborted" kalır; reset öncesi rollback yoksa
        # PostgreSQL bir sonraki set_config'te InFailedSqlTransaction verir.
        try:
            db.rollback()
        except Exception:
            pass
        try:
            reset_connection_rls_gucs(db)
        except Exception:
            pass
        db.close()
