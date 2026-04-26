# Veritabanı betikleri

- **`blinds-postgresql.sql`**: PostgreSQL için ilk kurulum / tam şema. Auth/RBAC + kiracı iskeleti + blinds iş alanı tabloları (örn. `customers`, `orders`, `estimate`, `blinds_type*`, `status_*`) ve tenant RLS policy’leri.
- **`blinds-mariadb.sql`**: MariaDB için uyarlanmış şema betiği (RLS/policy, plpgsql trigger/function ve PostgreSQL’e özel migration blokları çıkarılmış; “final şema” oluşturur).
- **`NN_*.sql`**: Yeni schema değişiklikleri için migration’lar. (Önceki **01..29** seti PostgreSQL tarafında tam şemaya konsolide edildi; yeni kurulum için `blinds-postgresql.sql` kullanın.)

Yeni migration eklerken mevcut en büyük numaradan bir sonrakini kullanın.

## Son eklenen migration’lar

- `30_postal_code_fields.sql`: Companies/Customers/Estimates için optional postal code alanları.
- `31_company_blinds_product_category_matrix.sql`: `company_blinds_product_category_matrix` — şirket başına hangi global `blinds_product_category` kodlarının kullanılacağı (status matrix’leriyle aynı fikir); mevcut şirket×aktif kategori backfill + RLS.
- `32_global_blinds_type_and_matrix.sql`: `blinds_type` satırlarını **global** kataloga taşır (`company_id` kaldırılır), `estimate` / `estimate_blinds` / `orders.blinds_lines` / matris tablolarındaki id’leri yeni global id’lere eşler, **`company_blinds_type_matrix`** ekler (şirket başına hangi tip etkin). `blinds-postgresql.sql` içinde aynı blok idempotent çalışır (zaten global ise atlar).
  - Not: Bu adım PostgreSQL tarafında `blinds-postgresql.sql` içine konsolide edildi; yeni kurulumlarda ayrı çalıştırmanız gerekmez.
- `35_orders_parent_order_id.sql`: Sipariş satırına `parent_order_id` ekler (anchor + line-item additions / ek siparişler için); `(company_id, parent_order_id)` FK ile aynı şirketteki anchor siparişe bağlar.
- `36_order_payment_entries_payment_group_id.sql`: `order_payment_entries` satırına `payment_group_id` ekler; tek bir “record payment” aksiyonunun (anchor + ek siparişlere dağıtılan) UI’de tek satır olarak gruplanmasını sağlar.
- `37_order_expense_entries.sql`: `order_expense_entries` (order-level masraf defteri) ekler; profit hesaplarında kullanılır, order total/balance/payments değiştirmez (soft delete: `is_deleted`).
- `38_order_line_photos.sql`: `order_attachments` içine per-blinds-line fotoğraflar için `kind='line_photo'` ve `blinds_type_id` alanını ekler (kumaş fotoğrafları).
