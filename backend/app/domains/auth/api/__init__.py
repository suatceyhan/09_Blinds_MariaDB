from app.domains.auth.api.auth import router as auth_router
from app.domains.auth.api.change_password import router as change_password_router
from app.domains.auth.api.password_reset import router as password_reset_router
from app.domains.auth.api.switch_company import router as switch_company_router
from app.domains.auth.api.switch_role import router as switch_role_router

__all__ = [
    "auth_router",
    "change_password_router",
    "password_reset_router",
    "switch_role_router",
    "switch_company_router",
]
