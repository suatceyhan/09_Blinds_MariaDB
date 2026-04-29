from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded

from app.core.bootstrap import (
    seed_company_owner_missing_permission_grants,
    seed_default_company_owner_role,
    seed_default_registration_role,
    seed_default_user_role_permission_grants,
    seed_starter_permissions,
    seed_super_admin,
    seed_superadmin_missing_permission_grants,
)
from app.core.config import settings
from app.core.database import SessionLocal, create_all_tables
from app.core.limiting import limiter
from app.core.middleware import auth_middleware
from app.domains.audit.api import system_audit_logs_router, user_audit_logs_router
from app.domains.auth.api import (
    auth_router,
    change_password_router,
    password_reset_router,
    switch_company_router,
    switch_role_router,
)
from app.domains.dashboard.api import dashboard_router
from app.domains.reports.api.financial import router as financial_reports_router
from app.domains.customers.api import customers_router
from app.domains.estimates.api import estimates_router
from app.domains.orders.api import orders_router
from app.integrations.google_calendar_router import router as google_calendar_router
from app.domains.business_lookups.api import business_lookups_router
from app.domains.settings.api.blinds_category_matrix import router as settings_blinds_matrix_router
from app.domains.settings.api.blinds_type_matrix import router as blinds_type_matrix_router
from app.domains.settings.api.contract_invoice_docs import router as contract_invoice_docs_router
from app.domains.settings.api.product_category_matrix import router as product_category_matrix_router
from app.domains.settings.api.order_workflow import router as order_workflow_router
from app.domains.settings.api.estimate_workflow import router as estimate_workflow_router
from app.domains.shared.api.workflow_action_types import router as workflow_action_types_router
from app.domains.shared.api.schema_fields import router as schema_fields_router
from app.domains.settings.api.status_matrices import router as status_matrices_router
from app.domains.company.api import companies_router, pending_company_registrations_router
from app.domains.lookup.api.permissions import router as permissions_router
from app.domains.lookup.api.roles import router as roles_router
from app.domains.user.api.pending_employee_registrations import (
    router as pending_employee_registrations_router,
)
from app.domains.user.api.public_registration import router as public_registration_router
from app.domains.user.api.role_permissions_admin import router as role_permissions_admin_router
from app.domains.user.api.rbac_user_roles import router as rbac_user_roles_router
from app.domains.user.api.user_permissions_admin import router as user_permissions_admin_router
from app.domains.user.api.users_admin import router as users_admin_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.resolved_upload_root().mkdir(parents=True, exist_ok=True)
    if settings.auto_create_tables:
        create_all_tables()
    with SessionLocal() as db:
        seed_super_admin(db)
        seed_default_registration_role(db)
        seed_default_company_owner_role(db)
        seed_starter_permissions(db)
        seed_default_user_role_permission_grants(db)
        seed_company_owner_missing_permission_grants(db)
        seed_superadmin_missing_permission_grants(db)
    yield


app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)
app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    return JSONResponse(
        status_code=429,
        content={
            "detail": "Too many requests. Please wait a moment before trying again.",
            "retry_after": getattr(exc, "retry_after", None),
        },
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_origin_regex=r"^http://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.middleware("http")(auth_middleware)

app.mount(
    "/uploads",
    StaticFiles(directory=str(settings.resolved_upload_root())),
    name="uploads",
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/ping")
def ping():
    return {"pong": True}


app.include_router(auth_router)
app.include_router(change_password_router)
app.include_router(password_reset_router)
app.include_router(switch_role_router)
app.include_router(switch_company_router)
app.include_router(dashboard_router)
app.include_router(financial_reports_router)
app.include_router(customers_router)
app.include_router(estimates_router)
app.include_router(orders_router)
app.include_router(google_calendar_router)
app.include_router(business_lookups_router)
app.include_router(settings_blinds_matrix_router)
app.include_router(status_matrices_router)
app.include_router(product_category_matrix_router)
app.include_router(blinds_type_matrix_router)
app.include_router(contract_invoice_docs_router)
app.include_router(order_workflow_router)
app.include_router(estimate_workflow_router)
app.include_router(workflow_action_types_router)
app.include_router(schema_fields_router)
app.include_router(user_audit_logs_router)
app.include_router(system_audit_logs_router)
app.include_router(roles_router)
app.include_router(permissions_router)
app.include_router(role_permissions_admin_router)
app.include_router(user_permissions_admin_router)
app.include_router(users_admin_router)
app.include_router(rbac_user_roles_router)
app.include_router(public_registration_router)
app.include_router(pending_employee_registrations_router)
app.include_router(companies_router)
app.include_router(pending_company_registrations_router)
