# Veritabanı betikleri

- **`blinds.sql`**: İlk kurulum / tam şema (idempotent parçalar). Auth/RBAC + kiracı iskeleti + blinds iş alanı tabloları (örn. `customers`, `orders`, `estimate`, `blinds_type*`, `status_*`) ve tenant RLS policy’leri.
- **`NN_*.sql`**: Sırayla çalıştırılan migration’lar. Dosya adı: **iki haneli sıra + alt çizgi + kısa açıklama**, örn. `01_migrate_company_registration.sql`, `02_add_index_foo.sql`.

Yeni migration eklerken mevcut en büyük numaradan bir sonrakini kullanın.

## Yeni blinds iş akışı migration’ları

- **`01_blinds_flow_core.sql`**: Lead → Estimate → Order → Installation akışı için ek tablolar/kolonlar (leads, order_items, payments, attachments) ve calendar sync alanları (app → Google, event id saklama).
- **`02_estimate_to_order_link.sql`**: Estimate onayı ile oluşturulan order’da kaynak estimate referansı (`orders.estimate_id`).
- **`03_estimate_multi_blinds.sql`**: Bir tahmine çoklu `blinds_type` (`estimate_blinds`); `estimate.blinds_id` opsiyonel yapılır ve mevcut tekili satırlar ilişki tablosuna kopyalanır.
- **`04_estimate_blinds_window_count.sql`**: `estimate_blinds.perde_sayisi` (tip başına pencere sayısı); legacy `estimate.perde_sayisi` tek satırlı kayıtlara geri doldurulur.
- **`05_company_google_calendar.sql`**: Şirket başına Google Calendar OAuth `refresh_token` + opsiyonel `google_account_email` (`company_google_calendar`); RLS `company_id` ile.
- **`06_estimate_visit_calendar_fields.sql`**: Tahmin ziyareti / takvim: `visit_time_zone`, `visit_address`, `visit_notes`, `visit_organizer_*`, `visit_guest_emails` (JSONB), `visit_recurrence_rrule` (NULL = tekrar yok).
- **`07_estimate_soft_delete.sql`**: `estimate.is_deleted` (liste/detay yalnızca aktif kayıtlar; silme API soft delete).
- **`08_companies_updated_at.sql`**: `companies.updated_at` — `set_updated_at()` tetikleyicisi ile uyum (eski DB’lerde kolon yoksa hata alınırdı).
- **`09_estimate_workflow_status.sql`**: `estimate.status` (`pending` | `converted` | `cancelled`); order oluşunca bağlı tahmin `converted` olur (tetikleyici). İptal için API/email senkronu `cancelled` durumunda atlanır.
- **`10_orders_blinds_lines.sql`**: `orders.blinds_lines` (JSONB) — sipariş oluştururken seçilen blinds tipleri/adetleri (estimate’ten de taşınır).
- **`11_company_tax_orders_tax_amount.sql`**: `companies.tax_rate_percent` (varsayılan KDV/satış vergisi %); `orders.tax_amount` — siparişte vergi tutarı (`tax_uygulanacak_miktar` × şirket oranı / 100, sunucuda hesaplanır).
- **`12_orders_order_note.sql`**: `orders.order_note` (sipariş notu metni).
- **`13_blinds_product_categories.sql`**: Global ürün kategorileri + şirket bazlı `blinds_type_category_allowed` matrisi; `blinds_lines[].category`.
- **`14_migrate_product_category_to_global.sql`**: Eski tenant başına kategori şemasından global şemaya tek seferlik geçiş (gerekirse).
- **`15_blinds_line_extra_attributes.sql`**: Ek sipariş satırı öznitelikleri (`lifting_system`, `cassette_type` vb.): `blinds_line_extra_kind`, `blinds_line_extra_option`, `blinds_type_extra_allowed`; JSON’da `blinds_lines[].<line_json_key>`.
- **`16_order_payment_entries.sql`**: `order_payment_entries` — `POST /orders/{id}/record-payment` ile kaydedilen tutarlar (tutar + `created_at`); sipariş detayında geçmiş listesi için.
