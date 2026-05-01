# Domain: Auth

- Login, refresh, logout, token iptali.
- `models` (refresh/revoked tabloları vb.), `schemas`, `repository`, `service`.
- JWT ve hash için `app.core.security` kullanılır.
- `revoked_tokens.token` MariaDB’de **JWT string’inin kendisini değil**, `SHA256(jwt)` **hex (64 char)** fingerprint’ini saklar (uzun JWT’ler + index/unique uyumu). Mevcut DB migration notu: `DB/README.md`.
