from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parents[2] / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = Field(
        default="Blinds API",
        validation_alias=AliasChoices("APP_NAME", "app_name"),
    )
    app_version: str = "0.1.0"
    debug: bool = Field(default=True, validation_alias=AliasChoices("DEBUG", "debug"))

    #: true: SQLAlchemy create_all() ile tabloları otomatik oluştur (dev). false: DB şeması SQL (örn. DB/blinds-mariadb.sql) ile yönetilir.
    auto_create_tables: bool = Field(
        default=True,
        validation_alias=AliasChoices("AUTO_CREATE_TABLES", "auto_create_tables"),
    )

    secret_key: str = Field(validation_alias=AliasChoices("SECRET_KEY", "secret_key"))
    algorithm: str = Field(default="HS256", validation_alias=AliasChoices("ALGORITHM", "algorithm"))
    password_pepper: str = Field(
        default="",
        validation_alias=AliasChoices("PASSWORD_PEPPER", "password_pepper"),
    )
    access_token_expire_minutes: int = Field(
        default=60,
        validation_alias=AliasChoices("ACCESS_TOKEN_EXPIRE_MINUTES", "access_token_expire_minutes"),
    )
    refresh_token_expire_minutes: int = Field(
        default=43200,
        validation_alias=AliasChoices("REFRESH_TOKEN_EXPIRE_MINUTES", "refresh_token_expire_minutes"),
    )

    database_url: str = Field(validation_alias=AliasChoices("DATABASE_URL", "database_url"))

    #: false: RLS GUC senkronu yapılmaz (DB'de 03_migrate_tenant_rls.sql yokken veya geçici dev).
    tenant_rls_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices("TENANT_RLS_ENABLED", "tenant_rls_enabled"),
    )

    super_admin_email: str = Field(
        default="",
        validation_alias=AliasChoices("SUPER_ADMIN_EMAIL", "super_admin_email"),
    )
    super_admin_password: str = Field(
        default="",
        validation_alias=AliasChoices("SUPER_ADMIN_PASSWORD", "super_admin_password"),
    )
    super_admin_name: str = Field(
        default="Super Admin",
        validation_alias=AliasChoices("SUPER_ADMIN_NAME", "super_admin_name"),
    )

    password_reset_token_expire_minutes: int = Field(
        default=30,
        validation_alias=AliasChoices(
            "PASSWORD_RESET_TOKEN_EXPIRE_MINUTES",
            "password_reset_token_expire_minutes",
        ),
    )
    #: true ise /password_reset/request JSON icinde reset_token doner (e-posta yok; sadece dev)
    password_reset_expose_token: bool = Field(
        default=False,
        validation_alias=AliasChoices(
            "PASSWORD_RESET_EXPOSE_TOKEN",
            "password_reset_expose_token",
        ),
    )

    #: Ön yüz kökü; şifre sıfırlama mailindeki bağlantı (örn. http://localhost:5173)
    frontend_url: str = Field(
        default="http://localhost:5173",
        validation_alias=AliasChoices("FRONTEND_URL", "frontend_url"),
    )

    smtp_host: str = Field(default="smtp.gmail.com", validation_alias="SMTP_HOST")
    smtp_port: int = Field(default=587, validation_alias="SMTP_PORT")
    smtp_username: str = Field(
        default="",
        validation_alias=AliasChoices("SMTP_USERNAME", "EMAIL_USER"),
    )
    smtp_password: str = Field(
        default="",
        validation_alias=AliasChoices("SMTP_PASSWORD", "EMAIL_PASS"),
    )
    smtp_use_tls: bool = Field(default=True, validation_alias="SMTP_USE_TLS")
    smtp_from_name: str = Field(
        default="Blinds",
        validation_alias=AliasChoices("FROM_NAME", "SMTP_FROM_NAME"),
    )

    #: true: POST /auth/register (anında hesap). false: POST /public-registration/employee + e-posta doğrulama + admin onayı (/pending-employee-registrations).
    public_registration_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices(
            "PUBLIC_REGISTRATION_ENABLED",
            "public_registration_enabled",
        ),
    )
    #: Bootstrap + yeni kayit: bu adda rol yoksa olusturulur ve uyelere atanir
    default_registered_role_name: str = Field(
        default="user",
        validation_alias=AliasChoices(
            "DEFAULT_REGISTERED_ROLE_NAME",
            "default_registered_role_name",
        ),
    )
    #: Onaylanan pending şirket kaydı: sahip kullanıcıya atanır (ör. admin)
    default_company_owner_role_name: str = Field(
        default="admin",
        validation_alias=AliasChoices(
            "DEFAULT_COMPANY_OWNER_ROLE_NAME",
            "default_company_owner_role_name",
        ),
    )
    #: Boşsa From = smtp_username (Gmail genelde bunu bekler)
    mail_from_address: str = Field(
        default="",
        validation_alias=AliasChoices("FROM_EMAIL", "MAIL_FROM_ADDRESS"),
    )

    #: Yerel dosya yükleme kökü (şirket logoları vb.). Boşsa `backend/data/uploads`.
    upload_root: str = Field(
        default="",
        validation_alias=AliasChoices("UPLOAD_ROOT", "upload_root"),
    )

    def resolved_upload_root(self) -> Path:
        if self.upload_root and str(self.upload_root).strip():
            return Path(str(self.upload_root).strip()).expanduser().resolve()
        return Path(__file__).resolve().parents[2] / "data" / "uploads"

    #: Google Calendar OAuth (boşsa bağlantı uçları 503 / senkron atlanır). Bkz. docs/GOOGLE_CALENDAR_SETUP.md
    google_oauth_client_id: str = Field(
        default="",
        validation_alias=AliasChoices("GOOGLE_OAUTH_CLIENT_ID", "google_oauth_client_id"),
    )
    google_oauth_client_secret: str = Field(
        default="",
        validation_alias=AliasChoices("GOOGLE_OAUTH_CLIENT_SECRET", "google_oauth_client_secret"),
    )
    google_oauth_redirect_uri: str = Field(
        default="http://127.0.0.1:8000/integrations/google/callback",
        validation_alias=AliasChoices("GOOGLE_OAUTH_REDIRECT_URI", "google_oauth_redirect_uri"),
    )

    #: false (default): new companies get empty tenant matrices (blinds types, categories, estimate/order statuses).
    #: Superadmin enables rows in Settings/Lookups before operational use. true restores legacy auto-fill on first touch.
    bootstrap_prefill_company_lookup_matrices: bool = Field(
        default=False,
        validation_alias=AliasChoices(
            "BOOTSTRAP_PREFILL_COMPANY_LOOKUP_MATRICES",
            "bootstrap_prefill_company_lookup_matrices",
        ),
    )
    #: true (default): when a company is created, persist default contract/deposit + final invoice templates in `company_document_templates`.
    bootstrap_seed_company_contract_invoice_templates: bool = Field(
        default=True,
        validation_alias=AliasChoices(
            "BOOTSTRAP_SEED_COMPANY_CONTRACT_INVOICE_TEMPLATES",
            "bootstrap_seed_company_contract_invoice_templates",
        ),
    )


settings = Settings()
