# Veritabanı betikleri

- **`blinds-postgresql.sql`**: PostgreSQL için ilk kurulum / tam şema. Auth/RBAC + kiracı iskeleti + blinds iş alanı tabloları (örn. `customers`, `orders`, `estimate`, `blinds_type*`, `status_*`) ve tenant RLS policy’leri.
- **`blinds-mariadb.sql`**: MariaDB için uyarlanmış şema betiği (RLS/policy, plpgsql trigger/function ve PostgreSQL’e özel migration blokları çıkarılmış; “final şema” oluşturur).
- **`NN_*.sql`**: Yeni schema değişiklikleri için migration’lar. (Önceki **01..29** seti PostgreSQL tarafında tam şemaya konsolide edildi; yeni kurulum için `blinds-postgresql.sql` kullanın.)

Yeni migration eklerken mevcut en büyük numaradan bir sonrakini kullanın.

## Son eklenen migration’lar

- `39_estimate_lead_source.sql`: `estimate.lead_source` (referral / advertising) alanı ekler; ay-ay müşteri kaynağı analizleri için.
