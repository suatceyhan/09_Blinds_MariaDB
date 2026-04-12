# Docker Compose

- `docker-compose.yml` — geliştirme: API + DB (+ web + redis isteğe bağlı).
- `docker-compose.prod.yml` veya profiller — üretim benzeri port bağlama, restart policy, resource limit.

Ortam dosyası ve sırlar **commit edilmez**; `.env` veya secret store kullanılır.
