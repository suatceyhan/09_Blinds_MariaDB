# Features

Her alt klasör bir ürün özelliği:

- `pages/` — route seviyesi ekranlar
- `components/` — yalnızca bu feature’a özel UI
- `hooks/` — feature state ve veri hook’ları
- `api.ts` — backend çağrıları (veya `api/` alt klasörü)

Büyüdükçe alt modül klasörleri açılabilir (`orders/list`, `orders/detail`).

**Şablon:** `auth/` altında `pages/`, `components/`, `hooks/` klasörleri `.gitkeep` ile yer tutucu; diğer feature’lar aynı yapıyla çoğaltılabilir.
