# Feature: Orders

Sipariş oluşturma, düzenleme, durum takibi.

## Edit order — navigation and additional orders

**Order detail (read-only):** recording payments is not shown on the view page; use **Edit order** to open the edit screen where payments can be recorded.

**Back to orders** (`/orders`) leaves the editor. **Cancel** (footer) only appears when the form is dirty; it resets local changes to the last loaded/saved snapshot (same tab). **Save** only appears when dirty; after a successful save the page reloads order data and stays on the edit URL.

**+ Additional order** appends another **Additional order #N** accordion section inline (no separate full-screen form). The new draft opens expanded; no blinds type is pre-selected until the user picks one. (`BlindsTypesGrid` avoids rendering attribute `<select>`s with an empty value when no line is checked—React requires each `value` to match an `<option>`.) Draft rows show `(draft)` until **Save**; saving creates each new addition via `POST /orders/{anchorId}/line-item-additions`, then patches all additional orders and the anchor. Draft rows can be removed with the trash control on the summary line.

When **`GET /orders/{id}`** returns **`job_edit_locked`** (anchor status **`builtin_kind` Done** + rolled-up job balance ~0), the edit screen locks lines, payments (including removing recorded Pay rows), additional orders, attachments, and line photos; **Add expense** remains available. New products should use a **new order** for the customer.

## Line photos (fabric reference)

In **Order view** and **Edit order**, each blinds type row has a **Photo** column for capturing/uploading one or more photos of the selected fabric.

- Upload endpoint: `POST /orders/{orderId}/line-photos` (`multipart/form-data`: `blinds_type_id`, `file`).
- Storage: files are served from `/uploads/...` (see `UPLOAD_ROOT` in backend config).
