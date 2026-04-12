# Blinds (FastAPI + React + PostgreSQL)

Bu proje, **giriş, kayıt, şifre değiştirme, şifremi unuttum / sıfırlama** akışlarını içerir. RBAC tabloları ve JWT ile uyumludur.

## Özellikler

| Özellik | Backend | Frontend |
|--------|---------|----------|
| Giriş | `POST /auth/login` | `/login` |
| Kayıt | `POST /auth/register` | `/register` |
| Şifre değiştir | `POST /auth/change_password` (JWT) | `/account/password` |
| Şifre unuttum | `POST /password_reset/request` + e-posta | `/forgot-password` |
| Yeni şifre (token) | `GET/POST /password_reset/validate|confirm` | `/reset-password?token=` |

- Açık kayıt `.env` ile kapatılabilir: `PUBLIC_REGISTRATION_ENABLED=false`
- Bootstrap `SUPER_ADMIN_*` ile ilk yönetici (opsiyonel)
- İlk açılışta varsayılan **`user`** rolü oluşturulur (self-service kayıt için)

## Hızlı başlangıç

**1. Veritabanı**  
PostgreSQL oluşturun. Şema için repodaki `DB/blinds.sql` veya `create_all_tables()` kullanın; ikisini aynı DB’de karıştırmayın.

**2. Backend** (`backend/`)

```bash
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
copy .env.example .env   # değerleri doldurun
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**3. Frontend** (`frontend/`)

```bash
npm install
copy .env.example .env   # isteğe bağlı: VITE_APP_TITLE, VITE_API_BASE
npm run dev
```

Vite varsayılanı `http://localhost:5173`; API proxy `/api` → `127.0.0.1:8000`.

## Marka ve başlık

- **Backend:** `APP_NAME` (`.env`)
- **Frontend:** `VITE_APP_TITLE` (`.env`) — `src/lib/brand.ts` ve `document.title`

## Ana environment değişkenleri

Özet: `DATABASE_URL`, `SECRET_KEY`, `PASSWORD_PEPPER`, JWT süreleri, `SUPER_ADMIN_*`, `FRONTEND_URL`, SMTP (`SMTP_*`), `PASSWORD_RESET_*`, `PUBLIC_REGISTRATION_ENABLED`, `DEFAULT_REGISTERED_ROLE_NAME`. Ayrıntı: `backend/.env.example`.

**Frontend:** Token’lar tarayıcıda kalıcıdır; hareketsizlik çıkışı için `frontend/.env` içinde `VITE_IDLE_LOGOUT_MINUTES` (varsayılan 30; `0` ile kapalı). Ayrıntı: `frontend/README.md`. Şablon UI metinleri **İngilizce**; onaylar ortalanmış modal ile (`ConfirmModal`).

## Klasör yapısı

Modüler backend ve Vite React ön yüzü için bkz. [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) (içerik proje evrimine göre güncellenebilir).
