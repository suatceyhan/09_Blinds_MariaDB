# Veritabanı betikleri

- **`blinds-postgresql.sql`**: PostgreSQL için ilk kurulum / tam şema. Auth/RBAC + kiracı iskeleti + blinds iş alanı tabloları (örn. `customers`, `orders`, `estimate`, `blinds_type*`, `status_*`) ve tenant RLS policy’leri. **`blinds_product_category`** ilk kurulumda **boş** başlar (ürün kategorileri Lookups’tan eklenir). **Workflow engine ve ilişkili migration’lar (40–45)** bu dosyanın sonunda (`$mig40$` … `$mig45$`) gömülüdür.
- **`blinds-mariadb.sql`**: MariaDB için uyarlanmış şema betiği (RLS/policy, plpgsql trigger/function ve PostgreSQL’e özel migration blokları çıkarılmış; “final şema” oluşturur).
- **`NN_*.sql`**: Yeni schema değişiklikleri için migration’lar. (Önceki **01..29** ve **40..45** seti PostgreSQL tarafında tam şemaya konsolide edildi; yeni kurulum için `blinds-postgresql.sql` kullanın.)

Yeni migration eklerken mevcut en büyük numaradan bir sonrakini kullanın ve gerektiğinde içeriği `blinds-postgresql.sql` ile senkron tutun.

## Son eklenen migration’lar

- `39_estimate_lead_source.sql`: `estimate.lead_source` (referral / advertising) alanı ekler; ay-ay müşteri kaynağı analizleri için.
- **40–45 (PostgreSQL):** Artık **`blinds-postgresql.sql`** içinde (`Migration 40` … `Migration 45`). Özet: workflow tabloları + Order varsayılan akışı; order workflow izinleri; `workflow_transitions.deleted_at`; Estimate workflow seed + izinleri; `status_order.builtin_kind` backfill.
