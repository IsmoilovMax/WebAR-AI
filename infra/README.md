# Infra

## Servislar

| Servis | Port | Vazifa |
|--------|------|--------|
| postgres (TimescaleDB) | 5432 | Multi-tenant ma'lumotlar + events hypertable |
| redis | 6379 | Event bus (Streams) |
| minio | 9000 / 9001 | Snapshot va kliplar |
| go2rtc | 1984 (host) | RTSP → WebRTC |
| ai-worker | 8000 | Inference |
| event-service | 8001 | Persist + alert + Roboflow |

## Buyruqlar

```bash
# root dan
npm run infra:up
npm run infra:down
npm run db:migrate
```

go2rtc `network_mode: host` da ishlaydi — brauzer WebRTC uchun UDP kerak.
Kamera qo'shilganda web ilova API orqali oqimlarni ro'yxatdan o'tkazadi.

## Hikvision tekshiruv

```bash
npm run camera:probe -- --host 192.168.1.64 --user admin --password '...'
```

AI uchun sub-stream ni 640x480 H.264 qilib sozlang.
