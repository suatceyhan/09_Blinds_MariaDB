# Veritabanı betikleri

- **`blinds-postgresql.sql`**: PostgreSQL için ilk kurulum / tam şema. Auth/RBAC + kiracı iskeleti + blinds iş alanı tabloları (örn. `customers`, `orders`, `estimate`, `blinds_type*`, `status_*`) ve tenant RLS policy’leri.
- **`blinds-mariadb.sql`**: MariaDB için uyarlanmış şema betiği (RLS/policy, plpgsql trigger/function ve PostgreSQL’e özel migration blokları çıkarılmış; “final şema” oluşturur).
- **`NN_*.sql`**: Yeni schema değişiklikleri için migration’lar. (Önceki **01..29** seti PostgreSQL tarafında tam şemaya konsolide edildi; yeni kurulum için `blinds-postgresql.sql` kullanın.)

Yeni migration eklerken mevcut en büyük numaradan bir sonrakini kullanın.

## Son eklenen migration’lar

- `39_estimate_lead_source.sql`: `estimate.lead_source` (referral / advertising) alanı ekler; ay-ay müşteri kaynağı analizleri için.
- `40_workflow_engine.sql`: Konfigüre edilebilir workflow engine tabloları (workflow definition + transitions + actions) ve Order için varsayılan akış seed’i.
- `41_permissions_order_workflow.sql`: Settings → Order workflow ekranı için permission key backfill (permissions + superadmin grants).
- `42_workflow_transitions_soft_delete.sql`: `workflow_transitions.deleted_at` — ayarlardan silinen geçişler kalır; **Show deleted / Restore** ile geri alınır; runtime yalnızca aktif (`deleted_at IS NULL`) geçişleri kullanır.
- `43_estimate_workflow_engine_seed.sql`: Global **Estimate workflow** varsayılanı (New → Pending → Converted/Cancelled) seed.
- `44_permissions_estimate_workflow.sql`: Settings → Estimate workflow ekranı için permission key backfill (permissions + superadmin grants).
- `45_status_order_builtin_kind.sql`: `status_order.builtin_kind` (order built-in status tanımları) — kod/seed’lerde hardcode id yerine `builtin_kind` ile çözümleme için.
