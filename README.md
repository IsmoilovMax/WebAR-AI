# AI Camera System

Hikvision CCTV kameralari uchun real vaqtdagi AI video-analitika platformasi.

**Detektorlar:** odam + tracking, yong'in/tutun, yiqilish, chekish (beta), jins va yosh guruhi.

> Batafsil: nima qilingani, har bir vazifa qanday ishlashi — **[docs/HOW_IT_WORKS.md](docs/HOW_IT_WORKS.md)**
>
> Mavjud React + Node saytga jonli CCTV va hodisalar jadvali — **[docs/INTEGRATION_EXISTING_SITE.md](docs/INTEGRATION_EXISTING_SITE.md)**

## Arxitektura

```
Hikvision RTSP ──► go2rtc ──► WebRTC ──► Next.js /live
       │
       └──► Python AI Worker ──► Redis Streams ──► Event Service
                                                      │
                                      ┌───────────────┼───────────────┐
                                      ▼               ▼               ▼
                                  Postgres         MinIO         Telegram /
                                 TimescaleDB      (clips)         Webhook
```

## Monorepo

| Papka | Vazifa |
|-------|--------|
| `apps/web` | Next.js 16 dashboard (live, events, analytics, cameras, settings) |
| `services/ai-worker` | RTSP decode, YOLO + ByteTrack, temporal qoidalar |
| `services/event-service` | Redis consumer, MinIO, alertlar, Roboflow upload |
| `packages/types` | Umumiy TypeScript shartnomalar |
| `infra` | docker-compose, migratsiyalar, go2rtc |

## Tezkor start

```bash
cp .env.example .env
# AUTH_SECRET, CREDENTIALS_ENCRYPTION_KEY, parollarni to'ldiring

npm install
npm run infra:up
npm run db:migrate
npm run create-admin -- --email admin@example.com --password '...' --org "Demo"
npm run dev
```

AI modellarni `services/ai-worker/models/` ga qo'ying:

- `person.pt` — YOLO person (COCO)
- `pose.pt` — YOLO pose
- `fire_smoke.pt` — Roboflow fine-tune
- `cigarette.pt` — chekish (beta)
- `face.pt` / `genderage.onnx` — demografiya

## Asosiy buyruqlar

```bash
npm run dev            # Next.js
npm run infra:up       # Postgres, Redis, MinIO, go2rtc, workers
npm run db:migrate     # SQL migratsiyalar
npm run camera:probe   # Hikvision ISAPI tekshiruv
npm run create-admin   # Birinchi foydalanuvchi
```

## Dashboard

- `/live` — WebRTC grid + event overlay
- `/events` — SSE lenta, snapshot/klip, false-positive belgilash
- `/analytics` — tendensiya, demografiya, detektor sifati
- `/cameras` — ISAPI probe, kamera CRUD, zona editori
- `/settings` — alertlar, foydalanuvchilar, modelllar, edge, billing, audit

## Huquqiy eslatma

Yuz / jins / yosh — biometrik ma'lumot. Embedding saqlanmaydi; faqat yosh guruhi (`young` / `middle` / `senior`) va jins. Ma'lumotlar O'zbekiston hududidagi serverda saqlanishi kerak.
