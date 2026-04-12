# `app` paketi

FastAPI uygulama kökü.

- **`main.py`:** app factory, lifespan, router mount, exception handler’lar.
- **`core`:** ayarlar, güvenlik, log.
- **`domains`:** iş modülleri (asıl sınır burada).
- **`api/v1`:** HTTP sürümü; domain servislerini çağırır.
