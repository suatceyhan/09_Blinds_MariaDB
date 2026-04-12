# API v1

- `router.py`: `include_router` ile health, auth ve domain router’ları.
- `routes/`: evrensel veya çok ince uçlar (ör. healthcheck).

Versiyon kırılmadan yeni davranış için önce v1 genişletilir; breaking change’te `v2` eklenir.
