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
- **Addresses:** single-line fields use **`AddressAutocompleteInput`** (`src/components/ui/AddressAutocompleteInput.tsx`): after **3+ characters**, debounced suggestions from **Photon / OpenStreetMap** (`src/lib/photonAddressSuggest.ts`, public `photon.komoot.io` — needs browser network access). **Settings → Company info** (and superadmin **Companies**) set **`country_code`** (`countrycode=` on Photon) and optional **`region_code`** (Canadian provinces/territories or US states + DC from `src/lib/companyRegions.ts`). When region is set, Photon gets **lat/lon/zoom** bias, the search string gains **province/state context** (e.g. `…, Ontario, Canada`), and only hits in that subdivision are shown when Photon tags them (`state` / `statecode` or the formatted line contains the province name). If the user types a **leading house number** and Photon only returns street/postcode segments, the UI **prepends that number** to the street line and **dedupes** multiple postcodes for the same street/city (OSM is not Canada Post–exact per door). `/auth/me` includes **`active_company_country_code`** and **`active_company_region_code`** for customer/estimate address fields. Company country dropdown is **CA / US / Any** plus a **legacy** option if the stored country is outside that list. Hint text under address fields (no sample placeholder in the input); **lists and detail views** use **`AddressMapLink`** → **Google Maps** (`src/lib/googleMaps.ts`). DB: **`DB/23_companies_country_code.sql`**, **`DB/24_companies_region_code.sql`**. Not Canada Post / AddressComplete.
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

**Estimates:** `/estimates` — search, schedule filter, **status filter** chips from **`GET /estimates/lookup/estimate-statuses`** (same **`sort_order`** as Lookups; filter query **`status_esti_id`**); built-in **`code`** values keep fixed chip colors, custom names use the same **name-based** palette as the orders list. **Show deleted**, **Status** column (label from **`status_estimate`**); **Visit date** column. **Actions**: **Make order** only when the row **`status`** is **`pending`** (and permission), plus edit/remove, or view + restore when deleted. **`/estimates/:id`** view (same **Make order** rule), **`/estimates/:id/edit`** PATCH form (**`status_esti_id`** from lookups). New estimate: compact modal — **Prospect** (name/contact; not stored under Customers until an order is saved) or **existing customer**; per blinds type optional **line amount**. **Visit date and time**: **VisitStartQuarterPicker** — date + time triggers open a **calendar + 15-minute time list** (fixed popover); date trigger **`Apr 1, 2026`**, time **`2:45 PM`** → `scheduled_wall`; estimates list **Visit date** column uses **`Apr 1, 2026 - 2:30 PM`**. **Time zone** beside it. **Organizer & employees**: organizer row locked on, optional employee checkboxes. **Blinds types**: checkbox + **Qty** per type; list **Types & windows** shows a check icon per line and amount when set. **`DELETE /estimates/:id`** soft delete.

**Orders:** `/orders` — list table: **Total** (subtotal + tax), **Paid** (down + `final_payment`), **Down payment**, **Balance** (no **Created** column on the list; detail still shows dates where relevant). **Agreement date** on the create form defaults to **today** (local date). **Make order** (`/orders?fromEstimate=…`): prefill aligns **category** with the blinds matrix when the estimate payload omits it; estimate **prospect** fills the customer block until save; **line amount** zero from the API shows as an empty field (placeholder) so you can type without clearing a stray `0`. **Edit order**: status **Ready for installation** requires **installation** date/time; when Google Calendar is connected, the backend syncs an installation event. **New / view / edit**: **Attachments** — **Take photo** (camera on supported devices), **Upload photo**, **Upload Excel**; on create, queued files upload after the order is created. **Recorded payments** (view): remove a **Pay** line (not down payment) via trash + **ConfirmModal**; **`DELETE /orders/.../payment-entries/...`**. **Show deleted** includes inactive (`active` false) rows; deleted rows are styled and omit edit; **Restore** opens **ConfirmModal** before `POST /orders/{id}/restore`. **New order** and **Edit order** use **`GET /orders/lookup/blinds-order-options`**: blinds grid is a **table** — **one row per blinds type** (checkbox + name), **columns** = **Qty** (number input 1–99 with stepper arrows), **Category** (column width follows header + longest option label; full value in tooltip / dropdown), **line amount** (up to six digits before the decimal, two after), **line note** last. Extra matrix columns (e.g. lifting) stay compact. If the table is wider than the card, **scroll horizontally inside the blinds section** so line notes stay reachable; the order modal body does not use a horizontal scrollbar. **Order note** sits full-width on the form grid like **Customer** / **Status**. The financial block shows **Total (incl. tax)** (line subtotal + tax), **Down payment**, **Taxable base**, then **Paid** (down + server **`final_payment`** on edit/view; create shows down only), **Balance due**, **Tax**. The API keeps **`orders.total_amount`** as the line subtotal and recalculates it from **`blinds_lines`** on create/patch. **Order detail**: **Payment** opens a modal to record an amount; **`POST /orders/{id}/record-payment`** appends a row in **`order_payment_entries`** and updates **`final_payment`** / **balance**. Between the financial block and **Dates**, **Recorded payments** lists down payment (if any) and each **Pay** amount with date/time, chronological order. **Order note** (full order) plus per-line notes. **Status** from **`GET /orders/lookup/order-statuses`**, agreement date. **Actions**: view, **Edit**, delete/restore. Company rate: **Settings → Company info**.

**Sidebar accordions** (Lookups, Reports, Settings, Permissions): one row (chevron + icon + label). **First click** opens the subtree and navigates to that group’s hub (`/lookups`, `/reports`, `/settings`, `/permissions`). **Second click** (while open) collapses the accordion without changing route until you pick a child link.

**Lookups:** `/lookups` — static overview; child pages share **`LookupPageLayout`** (icon header, description, search toolbar, table). **`/lookups/blinds-types`** (description supports line breaks; list wraps text), **`/lookups/blinds-product-categories`**, **`/lookups/blinds-extra-options/:kindId`** (e.g. `lifting_system`, `cassette_type`), **`/lookups/order-statuses`** — read-only list (search, show inactive); statuses are global; per-company enablement is **Permissions → Order status matrix** (`settings.order_status_matrix.*`). **`/lookups/estimate-statuses`** — same read-only pattern; optional response **`code`** for built-in workflow; matrix under **Permissions → Estimate status matrix** (`settings.estimate_status_matrix.*`). DB migrations **`27`** (global catalogs + matrix), **`28`** (prospect estimates, line amounts, ready-for-install status). Estimate edit saves **`status_esti_id`**.

**Reports:** `/reports` hub has **no** separate “Overview” nav row (same URL as the parent). Sub-nav: **Operational** → **Quarterly summary** → **Detail view** (toolbar demo). Hub pages are text-only; use the sidebar to drill in.

**Settings hub:** `/settings` — static overview; sidebar includes **Pending applications**, **Company info**, **Integrations**, **Blinds line matrices** (`settings.access.*`), etc.

**Settings → Blinds line matrices:** **`/settings/blinds-line-matrices`** — stacked matrices on one page: **product category** plus every active extra line attribute (e.g. lifting system, cassette type). Rows = options, columns = blinds types; **Save all changes**. Legacy **`/settings/blinds-category-matrix`** and **`/settings/blinds-extra-matrix/:kindId`** redirect here.

**Permissions hub:** `/permissions` — static overview; **Roles**, **Role permissions**, **User roles**, **User permissions**, **Estimate status matrix**, **Order status matrix** (checkbox grid: companies × global statuses). Legacy `/settings/roles` (and related paths) **redirect** to `/permissions/…`.

**Settings → Company info:** `/settings/company-info` — active company (header switcher) için ad, iletişim, adres ve **default sales tax (%)**; siparişte **taxable base** × bu oran = **tax amount** (sunucuda `orders.tax_amount`). Kayıt **`PATCH /companies/{id}`** (`companies.view` / `companies.edit`).

**Integrations:** `/settings/integrations` — Google Calendar OAuth (`companies.view` / `companies.edit`); yeni estimate’ler bağlı takvimde etkinlik oluşturabilir (backend `.env` + `docs/GOOGLE_CALENDAR_SETUP.md`).
