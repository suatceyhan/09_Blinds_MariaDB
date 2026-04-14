# Veritabanı betikleri

- **`blinds.sql`**: İlk kurulum / tam şema (idempotent parçalar). Auth/RBAC + kiracı iskeleti + blinds iş alanı tabloları (örn. `customers`, `orders`, `estimate`, `blinds_type*`, `status_*`) ve tenant RLS policy’leri.
- **`NN_*.sql`**: Yeni schema değişiklikleri için migration’lar. (Önceki **01..29** seti artık `blinds.sql` içinde konsolide.)

Yeni migration eklerken mevcut en büyük numaradan bir sonrakini kullanın.

## Son eklenen migration’lar

- `30_postal_code_fields.sql`: Companies/Customers/Estimates için optional postal code alanları.
- `31_company_blinds_product_category_matrix.sql`: `company_blinds_product_category_matrix` — şirket başına hangi global `blinds_product_category` kodlarının kullanılacağı (status matrix’leriyle aynı fikir); mevcut şirket×aktif kategori backfill + RLS.
