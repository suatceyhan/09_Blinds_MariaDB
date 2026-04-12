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

**Estimates:** `/estimates` — search, schedule filter, **status filter** chips from **`GET /estimates/lookup/estimate-statuses`** (same **`sort_order`** as Lookups; filter query **`status_esti_id`**), customer filter, **Show deleted**, **Status** column (label from **`status_estimate`**); **Actions** (when pending + permission: **Make order** → `/orders?fromEstimate=…`, edit, remove, or view + restore when deleted). **`/estimates/:id`** view (status, **Make order**, restore if deleted), **`/estimates/:id/edit`** PATCH form (**`status_esti_id`** from lookups). New estimate: compact modal. **Visit start**: **`datetime-local`** with 15-minute **`step`**, **blur** snaps to quarters, plus **Set** to confirm; **time zone** beside it. **Organizer & employees**: organizer row locked on, optional employee checkboxes. **Blinds types**: checkbox + **Qty** per type; list **Types & windows** shows a check icon per line. **`DELETE /estimates/:id`** soft delete.

**Orders:** `/orders` — list table: **Total** (subtotal + tax), **Paid** (down + `final_payment`), **Down payment**, **Balance** (no **Created** column on the list; detail still shows dates where relevant). **Agreement date** on the create form defaults to **today** (local date). **Make order** (`/orders?fromEstimate=…`): prefill aligns **category** with the blinds matrix when the estimate payload omits it; **line amount** zero from the API shows as an empty field (placeholder) so you can type without clearing a stray `0`. **New / view / edit**: **Attachments** — **Take photo** (camera on supported devices), **Upload photo**, **Upload Excel**; on create, queued files upload after the order is created. **Recorded payments** (view): remove a **Pay** line (not down payment) via trash + **ConfirmModal**; **`DELETE /orders/.../payment-entries/...`**. **Show deleted** includes inactive (`active` false) rows; deleted rows are styled and omit edit; **Restore** opens **ConfirmModal** before `POST /orders/{id}/restore`. **New order** and **Edit order** use **`GET /orders/lookup/blinds-order-options`**: blinds grid is a **table** — **one row per blinds type** (checkbox + name), **columns** = **Qty** (number input 1–99 with stepper arrows), **Category** (column width follows header + longest option label; full value in tooltip / dropdown), **line amount** (up to six digits before the decimal, two after), **line note** last. Extra matrix columns (e.g. lifting) stay compact. If the table is wider than the card, **scroll horizontally inside the blinds section** so line notes stay reachable; the order modal body does not use a horizontal scrollbar. **Order note** sits full-width on the form grid like **Customer** / **Status**. The financial block shows **Total (incl. tax)** (line subtotal + tax), **Down payment**, **Taxable base**, then **Paid** (down + server **`final_payment`** on edit/view; create shows down only), **Balance due**, **Tax**. The API keeps **`orders.total_amount`** as the line subtotal and recalculates it from **`blinds_lines`** on create/patch. **Order detail**: **Payment** opens a modal to record an amount; **`POST /orders/{id}/record-payment`** appends a row in **`order_payment_entries`** and updates **`final_payment`** / **balance**. Between the financial block and **Dates**, **Recorded payments** lists down payment (if any) and each **Pay** amount with date/time, chronological order. **Order note** (full order) plus per-line notes. **Status** from **`GET /orders/lookup/order-statuses`**, agreement date. **Actions**: view, **Edit**, delete/restore. Company rate: **Settings → Company info**.

**Sidebar accordions** (Lookups, Reports, Settings, Permissions): one row (chevron + icon + label). **First click** opens the subtree and navigates to that group’s hub (`/lookups`, `/reports`, `/settings`, `/permissions`). **Second click** (while open) collapses the accordion without changing route until you pick a child link.

**Lookups:** `/lookups` — static overview; **`/lookups/blinds-types`** (description supports line breaks; list wraps text), **`/lookups/blinds-product-categories`**, **`/lookups/blinds-extra-options/:kindId`** (e.g. `lifting_system`, `cassette_type`), **`/lookups/order-statuses`** — list, search, show inactive, create, edit (**sort order** for chip sequence), deactivate/restore (`lookups.view` / `lookups.edit`). **`/lookups/estimate-statuses`** — same pattern (`GET`/`POST`/`PATCH`); API **`workflow`** is `pending` \| `converted` \| `cancelled` or **`null`** for custom labels (no aggregate **“other”** filter). DB migrations **`20_status_estimate_custom_rows.sql`**, **`21_status_sort_order.sql`**. Estimate edit saves **`status_esti_id`**.

**Reports:** `/reports` hub has **no** separate “Overview” nav row (same URL as the parent). Sub-nav: **Operational** → **Quarterly summary** → **Detail view** (toolbar demo). Hub pages are text-only; use the sidebar to drill in.

**Settings hub:** `/settings` — static overview; sidebar includes **Pending applications**, **Company info**, **Integrations**, **Blinds line matrices** (`settings.access.*`), etc.

**Settings → Blinds line matrices:** **`/settings/blinds-line-matrices`** — stacked matrices on one page: **product category** plus every active extra line attribute (e.g. lifting system, cassette type). Rows = options, columns = blinds types; **Save all changes**. Legacy **`/settings/blinds-category-matrix`** and **`/settings/blinds-extra-matrix/:kindId`** redirect here.

**Permissions hub:** `/permissions` — static overview; **Roles**, **Role permissions**, **User roles**, **User permissions**. Legacy `/settings/roles` (and related paths) **redirect** to `/permissions/…`.

**Settings → Company info:** `/settings/company-info` — active company (header switcher) için ad, iletişim, adres ve **default sales tax (%)**; siparişte **taxable base** × bu oran = **tax amount** (sunucuda `orders.tax_amount`). Kayıt **`PATCH /companies/{id}`** (`companies.view` / `companies.edit`).

**Integrations:** `/settings/integrations` — Google Calendar OAuth (`companies.view` / `companies.edit`); yeni estimate’ler bağlı takvimde etkinlik oluşturabilir (backend `.env` + `docs/GOOGLE_CALENDAR_SETUP.md`).
