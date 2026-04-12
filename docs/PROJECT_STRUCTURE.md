# Proje dosya yapısı — orta ölçek & büyüğe yakın

Amaç: **modüler monorepo** — ekip büyüdükçe domain’ler ayrılabilir; API **v1/v2**, **workers**, **sözleşme (OpenAPI)**, **e2e** ve **gözlemlenebilirlik** için yer açık. Docker tanımları `infra/` altında kalır.

---

## Hedef ölçek profili

| Boyut | Beklenti |
|--------|-----------|
| **Orta** | Birden fazla domain modülü, entegrasyonlar (e-posta, dosya), ayrı test katmanları |
| **Büyüğe yakın** | Kuyruk ile async işler, cache, API sözleşmesi yayınlama, contract/e2e testleri, ileride K8s / gözlemleme şablonları |

---

## Kök dizin (monorepo kökü)

```text
repo/
├── README.md
├── .env.example
├── .gitignore
│
├── docs/
│   ├── PROJECT_STRUCTURE.md
│   ├── ADR/                      # Mimari karar kayıtları
│   └── openapi/                  # Referans / üretilmiş OpenAPI (opsiyonel)
│
├── contracts/                    # API sözleşmesi (OpenAPI YAML/JSON) — CI hedefi
│
├── backend/                      # FastAPI
├── frontend/                     # React (Vite)
├── mobile/                       # React Native / Flutter (ileride)
│
├── e2e/                          # Playwright / Cypress — uçtan uca
│
├── infra/
│   ├── docker/
│   │   ├── nginx/
│   │   ├── api.Dockerfile
│   │   └── web.Dockerfile
│   ├── compose/
│   ├── kubernetes/               # İleride orchestration manifest şablonları
│   ├── observability/           # Metrics/log örnekleri (Prometheus/Grafana/Loki)
│   └── scripts/
│
└── .github/
    └── workflows/
```

---

## Backend (`backend/`)

**İlke:** HTTP ince; **service** iş kuralları; **repository** veri erişimi; **domains** bounded context benzeri modüller. Büyüdükçe tek dosya → alt klasörlere bölünür.

```text
backend/
├── README.md
├── pyproject.toml                # veya requirements*.txt
├── .env.example
├── alembic/
│   ├── versions/
│   └── env.py
├── alembic.ini
│
├── app/
│   ├── main.py
│   │
│   ├── core/                     # config, güvenlik, logging, settings
│   ├── db/                       # engine, session, Base
│   ├── common/                   # Uygulama geneli exception, pagination DTO, sabitler
│   ├── middleware/             # request id, tenant, cors, timing
│   ├── infrastructure/         # Redis, broker, dış API istemcileri (arayüz + impl)
│   ├── workers/                # Kuyruk consumer / periyodik iş giriş noktaları
│   │
│   ├── api/
│   │   └── v1/
│   │       ├── router.py
│   │       └── routes/         # health, ince auth wrapper
│   │
│   ├── domains/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── companies/
│   │   ├── customers/
│   │   ├── orders/
│   │   ├── catalog/
│   │   └── shared/             # Domainler arası çok dikkatli paylaşılan küçük şeyler
│   │
│   └── integrations/
│       ├── email/
│       └── storage/
│
└── tests/
    ├── unit/
    ├── integration/
    └── contract/                 # OpenAPI’ye uygun API testleri (schemathesis vb.)
```

### Domain içi standart (şablonda)

| Parça | Rol |
|--------|-----|
| `models.py` | ORM (büyüyünce `models/`) |
| `schemas.py` | Pydantic (`schemas/` altına bölünebilir) |
| `repository.py` | DB sorguları |
| `service.py` | İş kuralları |
| `router.py` | HTTP (veya yalnızca `api/v1/routes` içinde toplanır) |

---

## Frontend (`frontend/`)

**İlke:** **Feature-Sliced Design** benzeri: `features` + `entities` + `shared`; **widgets** ve **processes** büyük ekran akışları için.

```text
frontend/
├── README.md
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
├── .env.example
├── public/
└── src/
    ├── app/                      # layout, providers, router tanımı
    ├── features/                 # sayfa+akış modülleri
    ├── entities/                 # domain entity UI + küçük mapper'lar
    ├── widgets/                  # birkaç entity birleşen bileşenler
    ├── processes/                # çok adımlı iş akışları (sipariş sihirbazı vb.)
    ├── shared/                   # ui, lib, hooks, config
    └── assets/
```

---

## Diğer kök klasörler

| Klasör | Rol |
|--------|-----|
| `contracts/` | OpenAPI tek doğruluk kaynağı veya export hedefi; mobil/web codegen |
| `e2e/` | Production-like ortamda senaryo testleri |
| `infra/kubernetes/` | Helm / kustomize / raw YAML şablonları (Plesk sonrası barındırma) |
| `infra/observability/` | Örnek scrape veya dashboard JSON |

---

## Ölçek büyüdükçe

| İhtiyaç | Yapı |
|--------|------|
| Repo bölme | `contracts/` publish + ayrı repo’lar |
| v2 API | `app/api/v2/` paralel |
| Event-driven | `domains/*/events.py` + `infrastructure/broker` |
| Çok kiracı | `middleware/tenant.py` + `companies` domain |

---

## Bu repoda ne var?

- **Backend (`backend/app`):** `03_DWP_TM` ile uyumlu **JWT auth** yığını taşındı: `app/core` (config, database, security, authorization, limiting, middleware, logger stub), `app/dependencies/auth.py`, `app/domains/auth` (login, refresh, logout, `/me`, `change_password`, `switch-role`, `set-default-role`), `app/domains/user/models` (RBAC + sadeleştirilmiş `Users` — company/status yok; `company_id` / `company_name` API’de `null`), `app/domains/lookup/models` (`role_groups`, `roles`, `permissions`). İlk açılışta `create_all_tables()`; isteğe bağlı `SUPER_ADMIN_*` ile seed (`app/core/bootstrap.py`).
- **Diğer:** Frontend ve infra iskeleti README’lerle duruyor; Dockerfile / Alembic migration ayrı adımda eklenebilir.
