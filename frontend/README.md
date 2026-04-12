# Frontend (React + Vite)

Modern panel: **Tailwind CSS v4**, **Plus Jakarta Sans**, giriş ekranında split layout; giriş sonrası üst bar + kenar çubuğu (`AppLayout`).

## Geliştirme

```bash
cd frontend
npm install
copy .env.example .env   # isteğe bağlı; varsayılan VITE_API_BASE=/api
```

Aynı makinede FastAPI’yi açın (`uvicorn`, port **8000**). Vite proxy `/api` isteklerini oraya yönlendirir.

```bash
npm run dev
```

Tarayıcı: [http://127.0.0.1:5173](http://127.0.0.1:5173)

## Auth

- `POST /auth/login` gövdesi **x-www-form-urlencoded** (`email`, `password`).
- `POST /auth/register` JSON ile kayıt; token’lar `starter_app_access_token`, `starter_app_refresh_token` (**localStorage**, tarayıcı kapanınca bile kalabilir).
- **Hareketsizlik:** Varsayılan **30 dk** içinde fare/klavye/API etkileşimi yoksa oturum temizlenir ve `/login` açılır. `.env`: `VITE_IDLE_LOGOUT_MINUTES` (dakika); `0` ile kapatılır. Süre, `starter_app_last_activity_ms` ile saklanır; PC yeniden açıldıktan sonra bu süre aşıldıysa doğrudan giriş ekranı görünür.

## UI conventions (this template)

- **English** end-user copy: menus (`appPages.ts`), auth, dashboard, settings, reports, layout.
- **Confirmations:** centered `ConfirmModal` (`src/components/ui/ConfirmModal.tsx`) for discard / remove / deactivate flows — not `window.confirm`.
- **Soft-deleted rows:** Roles, User roles, **Estimates** ve **Orders** listelerinde **Show deleted** (`ShowDeletedToggle`); estimates için **Restore** (`POST /estimates/:id/restore`, `include_deleted=true` list parametresi). Orders için: `DELETE /orders/{id}` soft delete, listede `GET /orders?include_deleted=true`, restore: `POST /orders/{id}/restore`.
- **Kayıt (DWP TM hizası):** `/register` her zaman **Employee** ve **Company** kartlarını gösterir. Sunucu anında kayda izin veriyorsa (`PUBLIC_REGISTRATION_ENABLED=true`) üçüncü kart **Instant signup** → `/register/direct`. Başvurular `/verify-email?token=…&type=employee|company`. Superadmin **Settings → Pending applications**.
- API error `detail` strings may still be non-English if the backend returns them that way.

## Yapı

- `src/app` — router, layout
- `src/features` — sayfalar (auth, dashboard, customers, **estimates**)
- `src/lib` — `api.ts`, `authStorage.ts`, `sessionIdle.ts`, `useSessionIdleTimeout.ts`
- `src/components/ui` — paylaşılan modal vb.

Yeni modüller: `src/features` altına ek sayfalar ve `AppRoutes` + `appPages.ts` menüsünü genişletin.

**Estimates:** `/estimates` — search, schedule filter, **status filter** (pending / converted to order / cancelled), customer filter, **Show deleted**, **Status** column; **Actions** (when pending + permission: **Make order** → `/orders?fromEstimate=…`, edit, remove, or view + restore when deleted). **`/estimates/:id`** view (status, **Make order**, restore if deleted), **`/estimates/:id/edit`** PATCH form. New estimate: compact modal. **`DELETE /estimates/:id`** soft delete.

**Orders:** `/orders` — list table: **Total** (subtotal + tax), **Paid** (down + `final_payment`), **Down payment**, **Balance**, … (no separate Tax column). **New / view / edit**: **Attachments** — **Take photo** (camera on supported devices), **Upload photo**, **Upload Excel**; on create, queued files upload after the order is created. **Recorded payments** (view): remove a **Pay** line (not down payment) via trash + **ConfirmModal**; **`DELETE /orders/.../payment-entries/...`**. **Show deleted** includes inactive (`active` false) rows; deleted rows are styled and omit edit; **Restore** opens **ConfirmModal** before `POST /orders/{id}/restore`. **New order** and **Edit order** use **`GET /orders/lookup/blinds-order-options`**: blinds grid is a **table** — **one row per blinds type** (checkbox + name), **columns** = Qty, **product category**, **line note**, **line amount** (lifting/cassette are not on this screen; use separate detail workflow). The financial block shows **Total (incl. tax)** (line subtotal + tax), **Down payment**, **Taxable base**, then **Paid** (down + server **`final_payment`** on edit/view; create shows down only), **Balance due**, **Tax**. The API keeps **`orders.total_amount`** as the line subtotal and recalculates it from **`blinds_lines`** on create/patch. **Order detail**: **Payment** opens a modal to record an amount; **`POST /orders/{id}/record-payment`** appends a row in **`order_payment_entries`** and updates **`final_payment`** / **balance**. Between the financial block and **Dates**, **Recorded payments** lists down payment (if any) and each **Pay** amount with date/time, chronological order. **Order note** (full order) plus per-line notes. **Status** from **`GET /orders/lookup/order-statuses`**, agreement date. **Actions**: view, **Edit**, delete/restore. Company rate: **Settings → Company info**.

**Sidebar accordions** (Lookups, Reports, Settings, Permissions): one row (chevron + icon + label). **First click** opens the subtree and navigates to that group’s hub (`/lookups`, `/reports`, `/settings`, `/permissions`). **Second click** (while open) collapses the accordion without changing route until you pick a child link.

**Lookups:** `/lookups` — static overview; **`/lookups/blinds-types`** (description supports line breaks; list wraps text), **`/lookups/blinds-product-categories`**, **`/lookups/blinds-extra-options/:kindId`** (e.g. `lifting_system`, `cassette_type`), **`/lookups/order-statuses`** — list, search, show inactive, create, edit, deactivate/restore (`lookups.view` / `lookups.edit`).

**Reports:** `/reports` hub has **no** separate “Overview” nav row (same URL as the parent). Sub-nav: **Operational** → **Quarterly summary** → **Detail view** (toolbar demo). Hub pages are text-only; use the sidebar to drill in.

**Settings hub:** `/settings` — static overview; sidebar includes **Pending applications**, **Company info**, **Integrations**, **Blinds line matrices** (`settings.access.*`), etc.

**Settings → Blinds line matrices:** **`/settings/blinds-line-matrices`** — stacked matrices on one page: **product category** plus every active extra line attribute (e.g. lifting system, cassette type). Rows = options, columns = blinds types; **Save all changes**. Legacy **`/settings/blinds-category-matrix`** and **`/settings/blinds-extra-matrix/:kindId`** redirect here.

**Permissions hub:** `/permissions` — static overview; **Roles**, **Role permissions**, **User roles**, **User permissions**. Legacy `/settings/roles` (and related paths) **redirect** to `/permissions/…`.

**Settings → Company info:** `/settings/company-info` — active company (header switcher) için ad, iletişim, adres ve **default sales tax (%)**; siparişte **taxable base** × bu oran = **tax amount** (sunucuda `orders.tax_amount`). Kayıt **`PATCH /companies/{id}`** (`companies.view` / `companies.edit`).

**Integrations:** `/settings/integrations` — Google Calendar OAuth (`companies.view` / `companies.edit`); yeni estimate’ler bağlı takvimde etkinlik oluşturabilir (backend `.env` + `docs/GOOGLE_CALENDAR_SETUP.md`).
