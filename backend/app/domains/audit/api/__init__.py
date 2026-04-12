from app.domains.audit.api.system_audit_logs import router as system_audit_logs_router
from app.domains.audit.api.user_audit_logs import router as user_audit_logs_router

__all__ = ["system_audit_logs_router", "user_audit_logs_router"]
