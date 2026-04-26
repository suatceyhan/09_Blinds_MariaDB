# Google Calendar — kurulum (adım adım)

## Adım 1 — Google Cloud (senden istenenler)

Bu adımı **sen** Google tarafında yapıyorsun; bitince bana / `.env` dosyana şunları yazacaksın:

1. [Google Cloud Console](https://console.cloud.google.com/) → yeni veya mevcut **proje**.
2. **APIs & Services → Library** → **Google Calendar API** → **Enable**.
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
4. İlk seferde **OAuth consent screen** sihirbazını tamamla:
   - User type: genellikle **External** (test kullanıcılarına kendi Gmail’ini ekle).
   - Scope ekle: `https://www.googleapis.com/auth/calendar.events` ve `https://www.googleapis.com/auth/userinfo.email` (bağlı hesabın e-postasını göstermek için).
5. OAuth client:
   - Application type: **Web application**.
   - **Authorized redirect URIs** içine **tam olarak** şunu ekle (backend callback):
     - Yerel: `http://127.0.0.1:8000/integrations/google/callback`
     - (İleride prod domain: `https://API-ADRESIN/integrations/google/callback`)
6. Oluşan ekrandan kopyala:
   - **Client ID**
   - **Client Secret**

Bunları backend `.env` içine koyacağız (Adım 2):

```env
GOOGLE_OAUTH_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
GOOGLE_OAUTH_REDIRECT_URI=http://127.0.0.1:8000/integrations/google/callback
```

**Not:** Redirect URI, Google’daki satır ile **byte-byte aynı** olmalı (http vs https, port, `/integrations/google/callback`).

## Adım 2 — Veritabanı migration

`company_google_calendar` tablosu güncel `DB/blinds-postgresql.sql` ile de gelir. Ayrı yalnızca bu tabloyu eklemek için `DB/05_company_google_calendar.sql` dosyasını çalıştır:

```bash
psql -U postgres -d 09_Blinds -f DB/05_company_google_calendar.sql
```

## Adım 3 — Bağlantı (OAuth)

1. Uygulamada giriş yap (aktif şirket seçili).
2. Ayarlar’dan veya API’den `GET /integrations/google/authorization-url` çağrılıp dönen URL’e gidilir (frontend’de buton ile açılır).
3. Google izin ekranı → izin ver → tarayıcı backend **callback**’e döner → refresh token şirket kaydına yazılır.
4. Bundan sonra yeni **estimate** oluşturulunca, bağlıysa etkinlik takvime eklenir (`primary` takvim).

## Etkinlik içeriği (estimate → Google)

- **Başlık (summary):** `Estimate for "<customer display name>"` (ad içindeki çift tırnak tek tırnağa indirgenir).
- **Açıklama:** Blinds satırları (tür + pencere sayısı), müşteri **telefonu**, ziyaret **notu** (`visit_notes`).
- **Süre:** Bitiş = başlangıç **+ 1 saat** (veritabanındaki `scheduled_end_at` bu senkron için kullanılmaz).
- **Zaman dilimi:** Estimate’taki `visit_time_zone` (IANA) Google `start`/`end` için kullanılır; uygulama oluştururken `scheduled_wall` + `visit_time_zone` ile duvar saati gönderilir.
- **Davetliler (attendees):** Yalnızca **Guest** alanından seçilen üye e-postaları (`visit_guest_emails`) — işi yapacak kişi. **Müşteri e-postası** takvime davet edilmez. **Organizatör**, etkinliği oluşturan bağlı Google hesabıdır (`company_google_calendar.google_account_email`); şirket `visit_organizer_*` bilgisi davetli listesine tekrar eklenmez (çoğu kurulumda zaten aynı hesaptır).

## Sorun giderme

- **redirect_uri_mismatch:** Google Console’daki Redirect URI ile `.env` içindeki `GOOGLE_OAUTH_REDIRECT_URI` farklı.
- **`InsecureTransportError` / OAuth 2 MUST utilize https:** Yerel `http://localhost` veya `http://127.0.0.1` callback kullanıyorsan `oauthlib` varsayılan olarak HTTP’yi reddeder. Bu repoda redirect URI bu hostlardan biri ise callback sırasında otomatik `OAUTHLIB_INSECURE_TRANSPORT=1` ayarlanır; yine de hata alırsan `.env` veya shell’de `OAUTHLIB_INSECURE_TRANSPORT=1` koyup API’yi yeniden başlat. **Production’da** callback adresi **https** olmalı; bu bayrak üretimde kullanılmamalı.
- **`Missing code verifier` / `invalid_grant`:** İki aşamalı OAuth’ta PKCE doğrulayıcı ilk istekte üretilip callback’te aynı Flow’da tutulmalı; biz yetkilendirme ve token için ayrı Flow kullandığımız için PKCE kapalı (`autogenerate_code_verifier=False`); web client + `client_secret` ile bu Google için uygundur.
- **`Scope has changed` / token alımı patlıyor:** `OAUTHLIB_RELAX_TOKEN_SCOPE=1` callback’te ayarlanır. Ayrıca `include_granted_scopes` kullanılmıyor (Google bazen yanıtta yalnızca kısmi scope listesi döndürüyordu). Takvim izni yine de yoksa Google hesabında uygulama erişimini kaldırıp yeniden bağlanın; izin ekranında takvim kutusu işaretli olsun.
- **Refresh token gelmiyor:** İlk bağlantıda veya `prompt=consent` ile yeniden yetkilendirme gerekir (kodda `access_type=offline` kullanılıyor).
