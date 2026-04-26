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
- Menü / rol matrisi: **Ana menüler** birbirinden ayrı izin anahtarları kullanır (`app_nav_permissions.APP_PERMISSION_SEEDS` + `frontend/src/config/appPages.ts`). **Lookups** hub `lookups.view` / `lookups.edit`; alt sayfalar ayrı anahtarlar (örn. `lookups.blinds_types.view`, tahmin/sipariş durum gridleri için `settings.estimate_status_matrix.*` / `settings.order_status_matrix.*`, ürün kategorisi için `lookups.product_categories.*`, …) — matriste satır başına bağımsız toggle; API **granular veya** eski geniş anahtarı kabul eder. Ürün kategorisi şirket matrisi: **`DB/31_company_blinds_product_category_matrix.sql`** + **`GET`/`PUT /permissions/product-category-matrix`**. **Companies** (`companies.*`) yalnızca şirket dizini; **Settings → Company info / Integrations** sırasıyla `settings.company_info.*`, `settings.integrations.*`; **Blinds line matrices** `settings.blinds_line_matrices.*`; **Permissions** kökü `permissions.access.*` (**`settings.access.*` değil**). API’de geçiş için bazı uçlar yeni anahtarlarla **`companies.*` / `settings.access.*` OR** kabul eder; yeni izinler bootstrap’ta `permissions` tablosuna eklenir, şirket sahibi rolünde eksik satır varsa otomatik **grant** edilir; mevcut DB’ler için **`DB/29_lookup_subpage_permissions.sql`** backfill.

## Hızlı başlangıç

**1. Veritabanı**  
PostgreSQL oluşturun. Şema için repodaki `DB/blinds-postgresql.sql` veya `create_all_tables()` kullanın; ikisini aynı DB’de karıştırmayın.
MariaDB için ayrı şema: `DB/blinds-mariadb.sql`.

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

**Tahmin / müşteri:** Tahmin oluştururken varsayılan olarak **yeni müşteri adayı (prospect)** girilebilir; kayıt `customers` tablosuna **sipariş kaydedilene kadar** yazılmaz. İsteğe bağlı **mevcut müşteri** seçimi de vardır. Tahmin satırlarında **tutar (line amount)** saklanır; siparişe aktarılır. DB: **`DB/28_estimate_prospect_line_amount_ready_install_status.sql`**. Yeni tahmin varsayılan durumu **New** (`builtin_kind=new`). **Converted** tahminde düzenleme ekranında statü değişmez; bağlı sipariş **iptal** (silme veya durum adında *cancel*) olunca tahmin **Cancelled** olur, sipariş geri alınınca uygun şekilde tekrar **Converted**. Müşteri / prospect **ad ve soyad** API’de kelime başı büyük harfe normalize edilir. Müşteri **deaktive** edilirken (`DELETE /customers/{id}`) bağlı **aktif sipariş** veya **açık tahmin** (durum **New** / **Pending**) varsa API **400** verir; kapatılmış tahminler ve pasif siparişler engellemez (satır soft-delete / pasif kalır).

**Sipariş / kurulum:** Global durum **Ready for installation** iken **kurulum tarih/saati** isteğe bağlıdır; girilmişse ve Google Calendar bağlıysa kurulum etkinliği oluşturulur/güncellenir.

## Klasör yapısı

Modüler backend ve Vite React ön yüzü için bkz. [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) (içerik proje evrimine göre güncellenebilir).

## Dashboard & Reports (son değişiklikler)

- **Dashboard** (`/`):
  - Yeni kartlar: **Estimates (New / Pending)**, **Orders (Ready for installation: With date / Missing date)**,
    **Estimate → Order (last 3 months)**, **Upcoming estimates**, **Upcoming installations**, **Order aging (weekly buckets)**.
- **Reports → Financial** (`/reports/financial`):
  - Tarih aralığı preset + custom range ile **Revenue**, **Collected**, **A/R balance**, **Profit**, **Tax**, **Taxable base**
    ve **Revenue vs Collected** trend (daily/weekly) raporları.
  - Ek tablo: **Monthly breakdown** (ay-ay revenue/expense/tax/profit).
- **Reports → Customer sources** (`/reports/customer-sources`):
  - Ay-ay **Estimates** ve **Orders** için müşteri kaynağı kırılımı: **Referral** / **Advertising** / **Unknown**.
  - Kaynak işaretleme: Estimate oluşturma/düzenlemede **Customer source** seçimi.
