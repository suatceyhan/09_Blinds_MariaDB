# Veritabanı betikleri

- **`blinds-postgresql.sql`**: PostgreSQL için ilk kurulum / tam şema. Auth/RBAC + kiracı iskeleti + blinds iş alanı tabloları (örn. `customers`, `orders`, `estimate`, `blinds_type*`, `status_*`) ve tenant RLS policy’leri. **`blinds_product_category`** ilk kurulumda **boş** başlar (ürün kategorileri Lookups’tan eklenir). Eski **lifting system / cassette type** satır ek özellik tabloları (`blinds_line_extra_*`, `blinds_type_extra_allowed`) kaldırıldı; dosyada kalan **`DROP IF EXISTS`** ve izin satırlarının **`is_deleted`** işaretlemesi mevcut veritabanları için geriye dönük temizlik yapar. **Workflow engine ve ilişkili migration’lar (40–45)** bu dosyanın sonunda (`$mig40$` … `$mig45$`) gömülüdür.
- **`blinds-mariadb.sql`**: MariaDB için uyarlanmış şema betiği (RLS/policy, plpgsql trigger/function ve PostgreSQL’e özel migration blokları çıkarılmış; “final şema” oluşturur).
- **`blinds-mariadb.clean.sql`**: `blinds-postgresql.clean.sql` dosyasının MariaDB uyumlu sürümü. PostgreSQL’e özel parçalar (RLS/policy, `DO $$`, `ON CONFLICT`, partial index) çıkarılmıştır; `uuid → CHAR(36)`, `timestamptz → DATETIME(6)`, `jsonb → JSON` dönüşümü ve `updated_at` trigger’ları içerir.
- **`NN_*.sql`**: Yeni schema değişiklikleri için migration’lar. (Önceki **01..29** ve **40..45** seti PostgreSQL tarafında tam şemaya konsolide edildi; yeni kurulum için `blinds-postgresql.sql` kullanın.)

Yeni migration eklerken mevcut en büyük numaradan bir sonrakini kullanın ve gerektiğinde içeriği `blinds-postgresql.sql` ile senkron tutun.

## Son eklenen migration’lar

- `48_estimate_blinds_line_note_mariadb.sql`: `estimate_blinds.line_note` — tahmin satır notu; siparişe dönüşümde **`GET /orders/prefill-from-estimate`** ile order **`blinds_lines[].line_note`** olarak gelir.
- `47_estimate_blinds_product_category_mariadb.sql`: `estimate_blinds.product_category_code` (FK → `blinds_product_category.code`, `ON DELETE SET NULL`) — tahmin perdeler satırında siparişteki gibi ürün kategorisi.
- `39_estimate_lead_source.sql`: `estimate.lead_source` (referral / advertising) alanı ekler; ay-ay müşteri kaynağı analizleri için.
- **40–45 (PostgreSQL):** Artık **`blinds-postgresql.sql`** içinde (`Migration 40` … `Migration 45`). Özet: workflow tabloları + RLS (global Order/Estimate geçiş seed’i yok); order workflow izinleri; `workflow_transitions.deleted_at`; migration 43 no-op; estimate workflow izinleri; `status_order.builtin_kind` backfill.
- `46_revoked_tokens_token_sha256_mariadb.sql` (MariaDB): `revoked_tokens.token` → `CHAR(64)` (JWT fingerprint). Detay: aşağıdaki “MariaDB notları” bölümü.

## MariaDB notları (JWT blacklist / `revoked_tokens`)

- Uzun JWT’ler `VARCHAR(255)` içine sığmayabilir. Bu repo artık `revoked_tokens.token` alanında **JWT’nin SHA-256 hex fingerprint’ini (64 char)** saklar.
- **Yeni kurulum:** `blinds-mariadb.clean.sql` güncel şemayı içerir.
- **Mevcut DB (manuel backfill):** Eski şemada `token` kolonu JWT’nin tamamını tutuyorsa, kolonu genişletip uygulamayı güncelledikten sonra eski satırları temizlemeniz gerekir (fingerprint ile uyumsuz olurlar):

```sql
ALTER TABLE revoked_tokens
  MODIFY COLUMN token CHAR(64) NOT NULL;

-- Opsiyonel: eski full-JWT satırlarını temizle (logout blacklist yeniden oluşur)
-- DELETE FROM revoked_tokens;
```
