# Workers (async / arka plan)

- Kuyruk consumer giriş noktaları (Celery, RQ, Dramatiq vb.).
- Periyodik işler (cron benzeri) tetikleyicileri.

API sürecinden ayrı process/container olarak çalıştırılmaları yaygındır; Compose’da ayrı servis tanımlanır.
