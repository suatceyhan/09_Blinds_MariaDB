# Infrastructure (teknik altyapı adaptörleri)

Dış sistemlere **arayüz + uygulama**:

- Redis (cache, rate limit store).
- Mesaj kuyruğu (RabbitMQ, Redis stream, SQS vb.) client factory.
- Üçüncü parti HTTP API sarmalayıcıları.

Domain katmanı mümkün olduğunca bu somut sınıflara doğrudan bağlanmaz; servis katmanı soyutlama veya DI ile kullanır.
