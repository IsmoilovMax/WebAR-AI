# Event Service

AI worker dan kelgan hodisalarni qayta ishlaydi:

1. Redis Streams (`acs:events`, `:sightings`, `:training`) ni tinglaydi
2. Snapshot / klipni MinIO ga yuklaydi
3. Postgres ga yozadi
4. Alert qoidalarini bajaradi (Telegram, webhook, email)
5. Active learning namunalarini Roboflow ga yuklaydi
6. Media retention (default 30 kun)

## Ishga tushirish

```bash
# infra orqali
npm run infra:up

# yoki lokal
cd services/event-service
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8001
```

## Muhit

`.env.example` dagi `DATABASE_URL`, `REDIS_URL`, `S3_*`, `TELEGRAM_BOT_TOKEN`,
`ROBOFLOW_*` o'zgaruvchilari ishlatiladi.
