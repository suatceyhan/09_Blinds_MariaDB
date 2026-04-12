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
Şema: kökteki **`DB/blinds.sql`** dosyası auth/RBAC + kiracı + blinds iş tablolarını oluşturur (`psql -f ../DB/blinds.sql`). Bu yolu seçtiyseniz `.env` içinde `AUTO_CREATE_TABLES=false` yapın; aksi hâlde uygulama açılışta `create_all_tables()` ile aynı tabloları tekrar oluşturmaya çalışabilir. `gen_random_uuid()` için PostgreSQL 13+ yeterlidir. Ödeme geçmişi için **`DB/16_order_payment_entries.sql`** + **`DB/17_order_payment_entries_soft_delete.sql`** + ekler için **`DB/18_order_attachments.sql`** (veya güncel `blinds.sql`) uygulanmalıdır.

## Çalıştırma

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- Swagger: `http://127.0.0.1:8000/docs`
- Auth: `POST /auth/login`, `POST /auth/register`, `POST /auth/refresh`, `GET /auth/me`, `POST /auth/logout`, `POST /auth/change_password`, `POST /auth/switch-role`, `POST /auth/set-default-role`, `POST /password_reset/*`
- Şirket (`companies`): list GET vb. **`PATCH /companies/{id}`** — `companies.edit` gerekir. **Etkin superadmin** tüm alanları (owner, restore vb.) güncelleyebilir; üye kullanıcı yalnızca kendi üyesi olduğu aktif şirkette **ad, telefon, e-posta, web, adres, `tax_rate_percent` (0–100)** değiştirebilir. **`updated_at`** kolonu yoksa ve `set_updated_at` tetikleyicisi varsa güncelleme hata verir; **`DB/08_companies_updated_at.sql`** (veya güncel `DB/blinds.sql`) çalıştırın. Şema: **`DB/11_company_tax_orders_tax_amount.sql`** (`tax_rate_percent`, `orders.tax_amount`).
- **Orders:** `GET /orders` (`search`, **`include_deleted`**, **`status_orde_id`**; varsayılan yalnızca `active=true`); list alanları totals + **`downpayment`**, **`final_payment`**, `balance`, `tax_amount` (Total sütunu için), `status_order` label join, `active`. **`GET /orders/{id}`** silinmiş (`active=false`) siparişi de döndürür; yanıtta **`final_payment`** (peşinattan sonraki toplam ek ödemeler; yoksa `null`) ve **`payment_entries`** (`id`, `amount`, `paid_at` — peşinat varsa sentetik `id=downpayment` satırı + `record-payment` kayıtları; hepsi `paid_at`’e göre kronolojik). **`DELETE /orders/{id}`** soft delete; **`POST /orders/{id}/restore`**. **`POST /orders/{id}/record-payment`** (`orders.edit`) — gövde `{"amount": "<pozitif decimal>"}`; tutar mevcut **balance due**’yu aşamaz; **`order_payment_entries`** satırı eklenir, `final_payment` / **`balance`** aktif satırların tutarından senkronlanır. **`DELETE /orders/{id}/payment-entries/{entry_uuid}`** — satır **soft-delete** (`is_deleted`); peşinat satırı (API’de `downpayment` id) yoktur. **`POST /orders/{id}/attachments`** (`multipart/form-data`: `kind`= `photo` \| `excel`, `file`) — foto (PNG/JPEG/WebP/GIF, max ~15MB) veya Excel/XLS/CSV (max ~25MB); dosyalar `UPLOAD_ROOT/orders/{company_id}/{order_id}/…` altında, URL `/uploads/…`. **`DELETE /orders/{id}/attachments/{attachment_uuid}`** — ek **soft-delete**. **`GET /orders/{id}`** yanıtında **`attachments`** listesi. **`GET /orders/lookup/order-statuses`**, **`GET /orders/lookup/blinds-order-options`** — sipariş formu için yalnızca **ürün kategorisi** (`line_attribute_rows` içinde kategori satırı; lifting/cassette sipariş JSON’unda tutulmaz, ayrı süreç). **`blinds_lines`**: `id`, `name`, `window_count`, **`category`**, **`line_note`**, **`line_amount`** (satır başına tutar; boş/0 kabul). **`POST /orders`**: **`total_amount`** istemciden bağımsız **satır `line_amount` toplamı** olarak yazılır. **`PATCH /orders/{id}`**: **`blinds_lines`** gönderilirse **`total_amount`** yine bu toplamdan güncellenir (aksi halde isteğe bağlı `total_amount` ile değiştirilebilir). Doğrulama: **`validate_blinds_lines_categories`** (kategori matrisi). Şema: **`DB/13_...`**, **`DB/14_...`**; **`DB/15_...`** ek türler yalnızca lookup/settings matrisleri için. **`GET/PUT /settings/blinds-category-matrix`**; **`GET /settings/blinds-extra-matrix-kinds`**, **`GET/PUT /settings/blinds-extra-matrix/{kind_id}`**. **`/lookups/blinds-product-categories`**; **`/lookups/blinds-extra-option-kinds`**, **`/lookups/blinds-extra-options/{kind_id}`**.
- Blinds flow: `GET /customers`, `POST /customers`, …; **`GET /estimates`** (`search`, **`schedule_filter`**, **`status_esti_id`** (tercih edilen filtre), isteğe bağlı geriye dönük **`status_filter`**: yalnızca `pending` \| `converted` \| `cancelled` (**`status_estimate.builtin_kind`** eşlemesi), **`include_deleted`**, **`customer_id`**), **`GET /estimates/lookup/estimate-statuses`** (liste chip’leri; `estimates.view`), **`GET /estimates/lookup/create-context`**, **`POST /estimates`** (**`blinds_lines`** boş olabilir), **`GET /estimates/{id}`** (soft-deleted dahil; **`status`** = `status_estimate.builtin_kind` veya `null`, **`is_deleted`**), **`PATCH /estimates/{id}`** (ziyaret + **`status_esti_id`** + **`blinds_lines`** — `blinds_lines` boş gönderilirse tüm `estimate_blinds` satırları silinir; silinmiş estimate’te yok), **`POST /estimates/{id}/restore`**, **`DELETE /estimates/{id}`** (soft delete), **`GET /estimates/lookup/blinds-types`**. **`GET`/`POST`/`PATCH /lookups/estimate-statuses`** ve **`GET`/`POST`/`PATCH /lookups/order-statuses`** — `sort_order` (**`DB/21_status_sort_order.sql`**). `status_estimate`: **`DB/22_status_estimate_builtin_kind.sql`** (`builtin_kind` NULL = özel etiket; **`/lookups/estimate-statuses`** yanıtında isteğe bağlı **`code`**). Eski **`DB/20_...`** `slug` adımı 22 sonrası devre dışı kalır. Şema: **`DB/07_...`**, **`DB/19_...`**, **`20`**, **`21`**, **`22`**, … **`/lookups`**: …
- Dashboard: `GET /dashboard/summary`
- **`GET /estimates`** listesinde müşteri **`customer_address`** (join `customers.address`) ve aramada adres de metne dahildir.

### Google Calendar (estimate → Google, planlı)

Kurulum: `docs/GOOGLE_CALENDAR_SETUP.md`. `.env`: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`. Şema: `DB/05_company_google_calendar.sql` veya güncel `DB/blinds.sql`. Bağımlılıklar: `requirements.txt` (Google API client).

**Uçlar (prefix `/integrations/google`):**

- `GET /integrations/google/authorization-url` — `companies.edit`; `{ "authorization_url" }` (OAuth yapılandırılmamışsa 503).
- `GET /integrations/google/callback` — Google yönlendirmesi; ön yüz `/settings/integrations?google_calendar=…`.
- `GET /integrations/google/status` — `companies.view`.
- `DELETE /integrations/google/connection` — `companies.edit`; OAuth satırını siler.

Şirket takvimi bağlıysa **`POST /estimates`** sonrası etkinlik oluşturulmaya çalışılır; başarıda `estimate.google_event_id` / `calendar_provider` / `calendar_last_synced_at` güncellenir. Etkinlik başlığı `Estimate for "…"` (müşteri adı), açıklama perdeler + telefon + not, bitiş saati başlangıcın **1 saat** sonrasıdır (`visit_time_zone` ile). `visit_recurrence_rrule` boş bırakılırsa Google’a **tekrar yok** (tek seferlik) davranır. Windows’ta IANA saat dilimi için `requirements.txt` içinde **`tzdata`** kullanılır. Yapılandırma veya bağlantı yoksa veya Google hata verirse işlem yine de başarılı döner (senkron hataları loglanır).

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
- **Şirket kaydı (DWP TM ile aynı fikir):** `GET /public-registration/options` ön yüzün anında kayıt mı başvuru mu göstereceğini söyler. Onay sonrası şirket kaydı oluşturulur ve sahip kullanıcı `DEFAULT_COMPANY_OWNER_ROLE_NAME` (varsayılan `admin`) ile atanır; rol yoksa `seed_default_company_owner_role` açılışta ekler.
- **`column users.company_id does not exist`:** `create_all()` eski tablolara kolon eklemez. Kökten: `psql -U … -d … -f DB/01_migrate_company_registration.sql`, sonra API’yi yeniden başlatın. Yeni migration dosyaları `02_…`, `03_…` şeklinde numaralandırılır (`DB/README.md`).
- `passlib` 1.7 ile **bcrypt 4.x** uyumsuz (`__about__` hatası); `requirements.txt` `bcrypt` sürümünü 3.x ile sınırlar. Çözüm: venv içinde `pip install -r requirements.txt`.
- `Users` modeli DWP’deki company/status/adres ilişkilerini içermez; `/auth/me` içinde `company_id` / `company_name` her zaman `null` döner.
- `SUPER_ADMIN_EMAIL` + `SUPER_ADMIN_PASSWORD` doluysa ilk başlatmada `superadmin` rolü ve kullanıcı oluşturulur (mevcut e-posta varsa atlanır).
