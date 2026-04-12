# Docker imaj tanımları

- `api.Dockerfile` — FastAPI/uvicorn çalışma imajı (multi-stage önerilir).
- `web.Dockerfile` — nginx + React `dist` veya Node build aşaması.
- `nginx/` — reverse proxy / SPA `try_files` örnek konfigürasyonları.

Plesk veya harici sunucuda çalışan konteynerler bu imajlardan türetilir.
