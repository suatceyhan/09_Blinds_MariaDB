# Veritabanı betikleri

- **`blinds.sql`**: İlk kurulum / tam şema (idempotent parçalar). Auth/RBAC + kiracı iskeleti + blinds iş alanı tabloları (örn. `customers`, `orders`, `estimate`, `blinds_type*`, `status_*`) ve tenant RLS policy’leri.
- **`NN_*.sql`**: Yeni schema değişiklikleri için migration’lar. (Önceki **01..29** seti artık `blinds.sql` içinde konsolide.)

Yeni migration eklerken mevcut en büyük numaradan bir sonrakini kullanın.
