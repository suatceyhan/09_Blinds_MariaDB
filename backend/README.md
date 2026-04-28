# Backend (FastAPI)

Modüler **domain** yapısı: JWT, RBAC, şifre sıfırlama e-postası. **Employee / company** başvuruları her zaman `POST /public-registration/employee|company` + e-posta doğrulama + superadmin onayı (`/pending-*-registrations`). `PUBLIC_REGISTRATION_ENABLED=true` ise ek olarak **anında kayıt** `POST /auth/register` açılır (`false` iken 403). `companies` + `users.company_id` + `pending_company_self_registrations` şema parçasıdır. `app/core/logger.py` yapılandırılmış log yazar.

## Kurulum

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
copy .env.example .env   # SECRET_KEY, DATABASE_URL zorunlu; isteğe bağlı SUPER_ADMIN_*
```

PostgreSQL URL örneği: `postgresql://user:pass@localhost:5432/myapp`  
Şema: kökteki **`DB/blinds-postgresql.sql`** dosyası auth/RBAC + kiracı + blinds iş tablolarını oluşturur (`psql -f ../DB/blinds-postgresql.sql`). Bu yolu seçtiyseniz `.env` içinde `AUTO_CREATE_TABLES=false` yapın; aksi hâlde uygulama açılışta `create_all_tables()` ile aynı tabloları tekrar oluşturmaya çalışabilir. `gen_random_uuid()` için PostgreSQL 13+ yeterlidir. Ödeme geçmişi / grup id ve ekler için **`DB/36_order_payment_entries_payment_group_id.sql`**, order masrafları için **`DB/37_order_expense_entries.sql`** (veya güncel PostgreSQL şeması) uygulanmalıdır.
Line-item additions (ek siparişler / anchor’a bağlı alt siparişler) için **`DB/35_orders_parent_order_id.sql`** (veya güncel PostgreSQL şeması) gereklidir.

## Çalıştırma

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- Swagger: `http://127.0.0.1:8000/docs`
- Auth: `POST /auth/login`, `POST /auth/register`, `POST /auth/refresh`, `GET /auth/me`, `POST /auth/logout`, `POST /auth/change_password`, `POST /auth/switch-role`, `POST /auth/set-default-role`, `POST /password_reset/*`
- Şirket (`companies`): list GET vb. **`PATCH /companies/{id}`** — `companies.edit` gerekir. **`POST /companies`** (superadmin) global **`status_*`** kataloglarını tetikler ve isteğe bağlı olarak varsayılan **sözleşme/fatura** şablonlarını yazar; **tenant matrisleri** varsayılan olarak boştur (**`BOOTSTRAP_PREFILL_COMPANY_LOOKUP_MATRICES`**, bkz. Notlar). Eski şirketlerde eksik kaldıysa ilk **`POST /estimates`** / sipariş akışı **400** döner (matris yapılandırın veya env ile legacy ön dolumu açın). **Etkin superadmin** tüm alanları (owner, restore vb.) güncelleyebilir; üye kullanıcı yalnızca kendi üyesi olduğu aktif şirkette **ad, telefon, e-posta, web, adres, `country_code` (ISO-3166-1 alpha-2, isteğe bağlı), `region_code` (isteğe bağlı; yalnızca `country_code` **CA** veya **US** iken kanonik alt bölüm kodu: CA eyaletleri/territory’ler, ABD eyaletleri + DC), `tax_rate_percent` (0–100)** değiştirebilir. **`POST /companies`** gövdesinde isteğe bağlı **`country_code`**, **`region_code`**. **`GET /auth/me`**: **`active_company_country_code`**, **`active_company_region_code`** (aktif şirket satırından). **`updated_at`** kolonu yoksa ve `set_updated_at` tetikleyicisi varsa güncelleme hata verir; **`DB/08_companies_updated_at.sql`** (veya güncel `DB/blinds-postgresql.sql`) çalıştırın. Kolonlar: **`DB/23_companies_country_code.sql`**, **`DB/24_companies_region_code.sql`**. Şema: **`DB/11_company_tax_orders_tax_amount.sql`** (`tax_rate_percent`, `orders.tax_amount`).
- **Orders:** `GET /orders` (`search`, **`include_deleted`**, **`status_orde_id`**; varsayılan yalnızca `active=true`); list alanları totals + **`downpayment`**, **`final_payment`**, **`installation_scheduled_start_at`**, `balance`, `tax_amount` (Total sütunu için), **`status_orde_id`**, `status_order` label join, `active`. **`GET /orders/{id}`** silinmiş (`active=false`) siparişi de döndürür; yanıtta **`final_payment`**, **`payment_entries`**, ayrıca **`expense_total`**, **`profit`** ve **`expense_entries`** döner. **`POST /orders/{id}/record-payment`** waterfall ile job’a dağıtır (UI’de tek satır görünür: `payment_group_id`). **Expenses (profit only):** **`POST /orders/{id}/expenses`** (`orders.edit`) — gövde `{"amount":"<pozitif decimal>","note":"...","spent_at":"<optional ISO>"}`; ödeme/bakiye değişmez. **`DELETE /orders/{id}/expenses/{expense_uuid}`** — satır soft-delete; **`GET /orders/{id}`** içinde listelenir. Profit hesabı: **(subtotal_ex_tax + tax_amount) − expense_total**.
- **Orders workflow engine (`DB/40_workflow_engine.sql`):** Status geçişleri koddan bağımsızdır (workflow tanımı DB’dedir). UI “Next” aksiyonunu ve gerekli form alanlarını backend’den okur.
  - **`GET /orders/{id}/workflow`**: Mevcut statü + izinli geçişler + transition action listesi (örn. `ask_form` → `installation_scheduled_start_at`).
  - **`POST /orders/{id}/workflow/transition`**: `{"to_status_orde_id":"...","data":{...}}` ile geçiş dener; eksik form alanı varsa `pending_actions` döner.
  - **ask_form target mapping:** `ask_form.config.fields[]` her field için opsiyonel `target`, `target_field`, `target_meta` destekler.
    - **`target="orders"`** (legacy: `order`): Çoğu kolon **`PATCH /orders/{id}`** ile güncellenir.
    - **Özel:** **`target_field="balance"`** — bakiye doğrudan yazılmaz; girilen miktar **`POST /orders/{id}/record-payment`** ile aynı kurallarla **`order_payment_entries`** üzerinden işlenir (Done öncesi tam ödeme şartını karşılar).
    - **`target="order_expense_entries"`** (legacy: `expenses`): değer `amount` olarak insert edilir.
  - **Schema fields (for action builder):** **`GET /schema/fields`** — `public` şemasındaki tablolar için `tables: { "<table_name>": [{field,type}, ...] }` döner (otomatik tip; `information_schema`). Workflow runtime yazımı şu an yalnızca **`orders`** ve **`order_expense_entries`** ile sınırlıdır; diğer tablolar keşif/liste içindir.
  - **Settings UI (Order):** `GET/PUT /settings/order-workflow` (permission: `settings.order_workflow.view|edit`). Transitions are **soft-deleted** (`workflow_transitions.deleted_at`); `GET` supports **`include_deleted=true`** for the settings screen. `PUT` syncs the **active** list (omitted rows are soft-deleted; at least one active transition required). Backfill: **`DB/41_permissions_order_workflow.sql`**, column: **`DB/42_workflow_transitions_soft_delete.sql`**.
  - **Settings UI (Estimate):** `GET/PUT /settings/estimate-workflow` (permission: `settings.estimate_workflow.view|edit`). Same soft-delete + sync behavior as Order. Default global seed: **`DB/43_estimate_workflow_engine_seed.sql`**, permissions backfill: **`DB/44_permissions_estimate_workflow.sql`**.
- **Contract / Invoice documents:** `GET /settings/contract-invoice/orders/{id}/deposit-contract` and `GET /settings/contract-invoice/orders/{id}/final-invoice` return **printable HTML** populated from the database (company + customer + order totals). Auth: `settings.contract_invoice.view`.
- **Customer-facing delivery:** estimates (Pending) can send/download **Deposit invoice + contract**: `GET /estimates/{id}/documents/deposit-contract`, `POST /estimates/{id}/documents/deposit-contract/send-email`; orders (Done) can send/download **Final invoice**: `GET /orders/{id}/documents/final-invoice`, `POST /orders/{id}/documents/final-invoice/send-email`. Emails use SMTP env (`SMTP_*`). Templates are editable per company in `company_document_templates` (`DB/33_company_document_templates.sql`).
  - PDF generation uses **wkhtmltopdf** (external binary). Ensure `wkhtmltopdf` is installed and available on `PATH`.
  - Deposit template presets: `teal_pro_01` (Corporate/Navy) and `classic_invoice_01` (Classic Invoice/Navy). The classic preset includes **Deposit received** and **Additional payments received** rows; additional payments are summed from `order_payment_entries` (soft-deleted rows excluded).
- Blinds flow: `GET /customers`, `POST /customers`, …; **`GET /estimates`** (`search`, **`schedule_filter`**, **`status_esti_id`** (tercih edilen filtre), isteğe bağlı geriye dönük **`status_filter`**: `new` \| `pending` \| `converted` \| `cancelled` (**`status_estimate.builtin_kind`** eşlemesi), **`include_deleted`**, **`customer_id`**), **`GET /estimates/lookup/estimate-statuses`** (liste chip’leri; `estimates.view` — her `builtin_kind` en fazla bir chip; yerleşik satırla **aynı ada** (trim, büyük/küçük harf yok sayılarak) sahip özel satırlar bu listede dönmez; tam liste **`/lookups/estimate-statuses`**), **`GET /estimates/lookup/create-context`**, **`POST /estimates`** (**`blinds_lines`** boş olabilir), **`GET /estimates/{id}`** (soft-deleted dahil; **`status`** = `status_estimate.builtin_kind` veya `null`, **`is_deleted`**), **`PATCH /estimates/{id}`** (ziyaret + **`status_esti_id`** + **`blinds_lines`** — `blinds_lines` boş gönderilirse tüm `estimate_blinds` satırları silinir; silinmiş estimate’te yok), **`POST /estimates/{id}/restore`**, **`DELETE /estimates/{id}`** (soft delete), **`GET /estimates/lookup/blinds-types`**. **`GET /lookups/estimate-statuses`** ve **`GET /lookups/order-statuses`** — `sort_order` (**`DB/21_status_sort_order.sql`**). `status_estimate`: **`DB/22_status_estimate_builtin_kind.sql`** (`builtin_kind` NULL = özel etiket; **`/lookups/estimate-statuses`** yanıtında isteğe bağlı **`code`**). Eski **`DB/20_...`** `slug` adımı 22 sonrası devre dışı kalır. Şema: **`DB/07_...`**, **`DB/19_...`**, **`20`**, **`21`**, **`22`**, … **`/lookups`**: …
- **Menü izinleri (nav):** `app/core/app_nav_permissions.py` — **Settings** altındaki şirket profili / entegrasyon / blinds matrisi için `settings.company_info.*`, `settings.integrations.*`, `settings.blinds_line_matrices.*`; **Permissions** ana menü için `permissions.access.*`. **Lookups alt sayfaları:** ayrı anahtarlar (örn. `lookups.blinds_types.view`, `lookups.order_statuses.view`, `lookups.product_categories.view`, …); **`/lookups/*`** uçları **granular veya** eski **`lookups.view` / `lookups.edit`** ile açılır. **`GET/PATCH /companies/{id}`** şirket kartı: `companies.*` **veya** `settings.company_info.*`. Google Calendar uçları: `companies.*` **veya** `settings.integrations.*`. Eski roller için OR ile uyum; yeni anahtarlar seed + **`DB/29_lookup_subpage_permissions.sql`** ile eklenir / backfill.
- **Global sipariş / tahmin durumları (`DB/27_global_status_tables_and_matrix.sql`):** `status_order` ve `status_estimate` genel katalog; şirket başına kullanım **`company_status_order_matrix`** / **`company_status_estimate_matrix`** ile. **`GET /lookups/order-statuses`** ve **`GET /lookups/estimate-statuses`** yalnızca matriste etkin satırları listeler. Matris API: **`GET`/`PUT /permissions/estimate-status-matrix`**, **`GET`/`PUT /permissions/order-status-matrix`** (`settings.*_status_matrix.view|edit`); süperadmin özel global satır: **`POST`/`PATCH /permissions/global-estimate-statuses`**, **`POST`/`PATCH /permissions/global-order-statuses`**. (Eski **`GET`/`POST`/`PATCH /lookups/*-statuses`** CRUD yolu kaldırıldı.)
- **Status lifecycle (best practice):**
  - **Built-in statuses are system-protected** (`builtin_kind` is set):
    - **Cannot be deactivated** (API returns 400).
    - Name / sort order may be edited (safe UI label changes).
  - **Custom statuses** (`builtin_kind` null) may be deactivated **only when unused**:
    - Not enabled in any company matrix.
    - Not referenced by any active workflow transition (`workflow_transitions.deleted_at IS NULL`).
    - Not referenced by domain data (`orders.status_orde_id`, `estimate.status_esti_id`).
  - **Order built-ins** use `status_order.builtin_kind` (migration: `DB/45_status_order_builtin_kind.sql`). Order/Estimate workflows resolve built-ins via `builtin_kind` (no hardcoded ids).
- **Ürün kategorisi şirket matrisi (`DB/31_company_blinds_product_category_matrix.sql`):** Global `blinds_product_category` + **`company_blinds_product_category_matrix`**. **`GET /lookups/blinds-product-categories`**: isteğe bağlı **`catalog_scope`** — **`tenant`** (varsayılan; matriste etkin kategoriler, sipariş/ayar uçlarıyla uyumlu) veya **`global`** (tam katalog; yönetim ekranı için **`lookups.product_categories.edit`** veya **`lookups.edit`** gerekir). **`GET /orders/lookup/blinds-order-options`** ve **`GET /settings/blinds-category-matrix`** sütunları matriste etkin kodlarla sınırlıdır. Matris: **`GET`/`PUT /permissions/product-category-matrix`** (`lookups.product_categories.view|edit` veya geniş **`lookups.view`/`lookups.edit`**). Yeni şirket: matris ön dolumu yalnızca **`BOOTSTRAP_PREFILL_COMPANY_LOOKUP_MATRICES=true`** iken; yeni kategori oluşturulunca tüm şirketlere matrix satırı eklenir.
- **Global blinds types (`DB/32_global_blinds_type_and_matrix.sql`):** `blinds_type` artık **şirketsiz** global katalog (`id` PK); **`company_blinds_type_matrix`** hangi şirketin hangi tipi kullanacağını tutar. **`GET /lookups/blinds-types`**: **`catalog_scope=tenant`** (varsayılan; aktif şirket matrisi) veya **`global`** (tam katalog; **`lookups.blinds_types.edit`** veya **`lookups.edit`**). **`GET`/`PUT /permissions/blinds-type-matrix`** — ürün kategorisi matrisiyle aynı hücre modeli (`MatrixPutIn`). Tahmin/sipariş/ayar uçları yalnızca matriste etkin tipleri listeler. Yeni şirket için tip matrisi ön dolumu yalnızca **`BOOTSTRAP_PREFILL_COMPANY_LOOKUP_MATRICES=true`** iken; yeni tip oluşturulunca tüm şirketlere matrix satırı eklenir.
- **`DB/28_estimate_prospect_line_amount_ready_install_status.sql`:** `estimate.customer_id` isteğe bağlı; **prospect** alanları; **`estimate_blinds.line_amount`**. **`POST/PATCH /estimates`**: müşteri veya aday; **`POST /orders`** tahminden, `customer_id` yoksa sipariş kaydında müşteri oluşturulup tahmin bağlanır. Global sipariş durumu **Ready for installation**; **`PATCH /orders/{id}`** bu duruma geçerken **`installation_scheduled_start_at`** isteğe bağlıdır; doluysa ve Google Calendar bağlıysa kurulum etkinliği yazılır/güncellenir.
- **Global status seed (`ensure_global_estimate_catalog_seeded`):** Yerleşik tahmin satırları eklenirken hem **`id`** hem **`builtin_kind`** çakışması kontrol edilir; migration sonrası farklı `id` ile aynı `builtin_kind` kalmışsa **UniqueViolation** oluşmaz (matris / `GET` uçları açılır).
- **Kiracı kapsamı (company):** PostgreSQL RLS (`app.tenant_company_id`) yanında, süperadmin oturumunda RLS bypass açık olduğu için **`GET /customers`** (isteğe bağlı `company_id` yalnızca süperadmin), **`GET /users`** ve **`GET /dashboard/summary`** sonuçları **her zaman** JWT’deki **aktif şirket** (`effective_company_id` / `resolve_tenant_company_id` — `app/dependencies/auth.py`) ile SQL’de filtrelenir; böylece yeni firmaya geçildiğinde başka firmaların müşteri / kullanıcı / özet verisi görünmez.
- **Müşteri deaktivasyonu:** **`DELETE /customers/{id}`** müşteriyi pasifleştirir (`active=false`). **400** döner: (1) müşteriye bağlı **`orders.active=true`** satırı varken; (2) silinmemiş (`estimate.is_deleted` değil) ve **`status_estimate.builtin_kind`** **`new`** veya **`pending`** olan tahmin varken. **Converted / cancelled** tahminler veya yalnızca pasif siparişler engel oluşturmaz; satır silinmez (FK / geçmiş korunur). **`POST /customers/{id}/restore`** geri alır.
- **Tahmin oluşturma / ad-soyad:** **`POST /estimates`** yeni kayda varsayılan **`status_estimate.builtin_kind = 'new'`** (şirket matrisinde etkin `new` satırı; yoksa **400** — matrisi yapılandırın veya **`BOOTSTRAP_PREFILL_COMPANY_LOOKUP_MATRICES=true`**). **`POST/PATCH /customers`** ve tahmindeki **prospect** `name` / `surname` ile siparişte prospect’ten oluşturulan müşteri adları kayıtta **kelime başı büyük, kalanı küçük** harfe normalize edilir (`app/core/person_names.py`).
- **Sipariş ↔ tahmin (iptal / geri al):** Sipariş satırında **`estimate_id`** doluysa: **`DELETE /orders/{id}`** (soft delete) sonrası veya **`PATCH /orders/{id}`** ile sipariş durumu adında **`cancel`** geçiyorsa (ör. *Cancelled*), bağlı tahmin **`status_esti_id`** otomatik **Cancelled** (`status_estimate.builtin_kind`) olur. **`PATCH`** ile durum **cancel**’dan başka bir matris durumuna dönerse veya **`POST /orders/{id}/restore`** ile sipariş geri alınırsa**, tahmin yalnızca o an **Cancelled** ise tekrar **Converted** yapılır. **`PATCH /estimates/{id}`**: tahmin **`converted`** iken **`status_esti_id` gönderilemez** (durum yalnızca sipariş iptali/geri alma ile senkronlanır).
- Dashboard: `GET /dashboard/summary`
- **Financial reports (Reports → Financial):**
  - `GET /reports/financial/summary` — revenue/collected/balance/profit/tax totals (date range)
  - `GET /reports/financial/ar` — outstanding balance totals + top balances (date range)
  - `GET /reports/financial/timeseries` — revenue vs collected trend (`group=daily|weekly`)
  - `GET /reports/financial/monthly` — month-by-month revenue/expense/tax/profit (date range)
  - `GET /reports/financial/orders` — order list with revenue/collected/balance/tax/expense/profit (date range; `only_positive_balance=true` for A/R)

Dashboard summary ayrıca aşağıdaki metrikleri de içerir:

- `new_estimates_count`, `pending_estimates_count`
- `ready_install_with_date_count`, `ready_install_missing_date_count`
- `estimate_conversion_last_3_months` (ay-ay converted count + %)
- `upcoming_estimates` (yaklaşan ziyaretler)
- **`GET /estimates`** listesinde müşteri **`customer_address`** (join `customers.address`) ve aramada adres de metne dahildir.

### Google Calendar (estimate → Google, planlı)

Kurulum: `docs/GOOGLE_CALENDAR_SETUP.md`. `.env`: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`. Şema: `DB/05_company_google_calendar.sql` veya güncel `DB/blinds-postgresql.sql`. Bağımlılıklar: `requirements.txt` (Google API client).

**Uçlar (prefix `/integrations/google`):**

- `GET /integrations/google/authorization-url` — `companies.edit`; `{ "authorization_url" }` (OAuth yapılandırılmamışsa 503).
- `GET /integrations/google/callback` — Google yönlendirmesi; ön yüz `/settings/integrations?google_calendar=…`.
- `GET /integrations/google/status` — `companies.view`.
- `DELETE /integrations/google/connection` — `companies.edit`; OAuth satırını siler.

Şirket takvimi bağlıysa **`POST /estimates`** sonrası etkinlik oluşturulmaya çalışılır; başarıda `estimate.google_event_id` / `calendar_provider` / `calendar_last_synced_at` güncellenir. Etkinlik başlığı `Estimate for "…"` (müşteri adı), açıklama perdeler + telefon + not, bitiş saati başlangıcın **1 saat** sonrasıdır (`visit_time_zone` ile). `visit_recurrence_rrule` boş bırakılırsa Google’a **tekrar yok** (tek seferlik) davranır. Windows’ta IANA saat dilimi için `requirements.txt` içinde **`tzdata`** kullanılır. Yapılandırma veya bağlantı yoksa veya Google hata verirse işlem yine de başarılı döner (senkron hataları loglanır). Sipariş **Ready for installation** + kurulum zamanı için ayrı takvim yazımı (kurulum başlığı/açıklaması) uygulanır.

## İlk kullanıcı (CLI)

`.env` içinde `DATABASE_URL` doğru olmalı. API çalışmasa da olur.

```bash
cd backend
.\.venv\Scripts\activate
python scripts/create_user.py --email you@example.com --password "güvenliSifre"
python scripts/create_user.py --demo
```

DWP `create_test_user.py` ile ayni mantik: `--demo` → `employee` + kullanici + `superadmin` rol kaydi (sifre her calistirmada demo kullaniciya yenilenir). E-posta zaten varsa ozel kullanici icin `--update`. `--role` (varsayilan `superadmin`) ile tum CLI modu.

## Notlar

- **`user_roles` soft delete:** Kaldır atama silinmiş (`is_deleted`) satırı bırakır; `(user_id, role_id)` benzersiz olduğu için aynı çifti tekrar atarken `POST /user-roles` artık **yeni satır eklemez**, mevcut satırı **yeniden etkinleştirir** (201 yerine 200).
- **`roles` soft delete:** `uq_roles_name` tüm tabloya uygulanır; silinmiş bir rolün adıyla yeniden oluştururken `POST /roles` **INSERT yerine** aynı isimli silinmiş satırı **yeniden etkinleştirir** ve gövdedeki açıklama / `is_protected` / `role_group_id` alanlarını günceller (201 yerine **200**).
- **Listeler:** `GET /roles?include_deleted=true` yalnızca **superadmin** için silinmiş rolleri de döndürür (ayarlar ekranı). `GET /user-roles?include_deleted=true` tüm atamaları (soft silinmiş dahil) listeler; yeniden açmak için yine `POST /user-roles` veya roller için `PATCH /roles/{id}` ile `is_deleted: false`.
- **Bootstrap superadmin assignment:** `GET /user-roles` returns `removable: false` for the row whose user email matches `SUPER_ADMIN_EMAIL` and role is `superadmin`. `DELETE /user-roles/{assignment_id}` responds with **403** for that assignment (cannot soft-delete it). The UI does not allow selecting `superadmin` for manual assignment.
- **Şirket kaydı (DWP TM ile aynı fikir):** `GET /public-registration/options` ön yüzün anında kayıt mı başvuru mu göstereceğini söyler. Onay sonrası şirket kaydı oluşturulur ve sahip kullanıcı `DEFAULT_COMPANY_OWNER_ROLE_NAME` (varsayılan `admin`) ile atanır; rol yoksa `seed_default_company_owner_role` açılışta ekler. **`POST /companies`** ve onay akışı (`PendingCompanyRegistrationService`) global durum kataloglarını garanti eder, varsayılan **tenant matrisleri** ve **sözleşme/fatura şablonları** için bkz. aşağıdaki bootstrap maddeleri.
- **`column users.company_id does not exist`:** `create_all()` eski tablolara kolon eklemez. Kökten: `psql -U … -d … -f DB/01_migrate_company_registration.sql`, sonra API’yi yeniden başlatın. Yeni migration dosyaları `02_…`, `03_…` şeklinde numaralandırılır (`DB/README.md`).
- `passlib` 1.7 ile **bcrypt 4.x** uyumsuz (`__about__` hatası); `requirements.txt` `bcrypt` sürümünü 3.x ile sınırlar. Çözüm: venv içinde `pip install -r requirements.txt`.
- `Users` modeli DWP’deki company/status/adres ilişkilerini içermez; `/auth/me` içinde `company_id` / `company_name` her zaman `null` döner.
- `SUPER_ADMIN_EMAIL` + `SUPER_ADMIN_PASSWORD` doluysa ilk başlatmada `superadmin` rolü ve kullanıcı oluşturulur (mevcut e-posta varsa atlanır).
- **Bootstrap defaults (first install):**
  - **`seed_superadmin_missing_permission_grants`** keeps the **`superadmin`** role aligned with every row in **`permissions`** (all toggles ON for that role).
  - Non-superadmin roles (**`DEFAULT_REGISTERED_ROLE_NAME`**, **`DEFAULT_COMPANY_OWNER_ROLE_NAME`**) start with **no** **`role_permissions`** rows from the API bootstrap (grant access in **Settings → Role permissions**).
  - **`BOOTSTRAP_PREFILL_COMPANY_LOOKUP_MATRICES`** (default **`false`**): new companies do **not** auto-enable blinds types, product categories, or estimate/order statuses in tenant matrices; configure them under **Settings / Lookups** before operational estimates/orders (otherwise **`POST /estimates`** / order flows return **400** with a clear hint). Set to **`true`** to restore the legacy “prefill empty matrices from globals” behavior.
  - **`BOOTSTRAP_SEED_COMPANY_CONTRACT_INVOICE_TEMPLATES`** (default **`true`**): **`POST /companies`** and approved pending company registration persist **deposit_contract** + **final_invoice** defaults into **`company_document_templates`**. PDF/HTML still fall back to built-in presets when rows are missing.
  - **PostgreSQL bundle:** older **`DB/blinds-postgresql.sql`** snippets may still insert demo **`role_permissions`** or matrix rows; align DB scripts with your policy if you need an empty RBAC/matrices story from SQL alone.
