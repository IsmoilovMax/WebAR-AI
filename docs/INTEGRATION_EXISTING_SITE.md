# Mavjud React + Node.js saytga ulash

ACS (shu loyiha) **alohida** ishlaydi: AI, RTSP, go2rtc, Postgres shu yerda.

Sizning saytingiz faqat:

1. **Jonli CCTV** — WebRTC (WHEP) orqali
2. **Hodisalar jadvali** — webhook JSON ni o'z DB ga yozish

```
Hikvision → ACS (AI + go2rtc)
                │
                ├── WebRTC WHEP ──► sizning Node BFF ──► React player
                ├── Overlay SSE ──► sizning Node BFF ──► canvas (odam/olov box)
                └── POST webhook ──► sizning /api/acs/webhook ──► jadval
```

---

## 0. ACS ni tayyorlash

1. ACS ni ishga tushiring (`npm run infra:up`, `db:migrate`, kamera qo'shing) — [HOW_IT_WORKS.md](./HOW_IT_WORKS.md)
2. `.env` ga qo'shing:

```bash
ACS_SERVICE_TOKEN=   # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

3. ACS dashboard → **Sozlamalar → Alertlar** → webhook qoidasi:
   - URL: `https://SIZNING-SAYT.uz/api/acs/webhook`
   - Secret: umumiy HMAC kalit (masalan 32 belgi)
   - Event types: `fire`, `smoke`, `fall`, `smoking`, ...
   - Min severity: `medium` (yoki keragicha)

---

## 1. Webhook JSON (ACS yuboradi)

ACS event-service quyidagi body ni `POST` qiladi. Imzo: `X-ACS-Signature` = HMAC-SHA256(secret, rawBody) hex.

```json
{
  "eventId": "uuid",
  "orgId": "uuid",
  "cameraId": "uuid",
  "cameraName": "Kirish",
  "eventType": "fall",
  "severity": "critical",
  "confidence": 0.91,
  "startedAt": "2026-07-27T06:00:00.000Z",
  "confirmedAt": "2026-07-27T06:00:03.000Z",
  "trackId": 12,
  "bbox": [0.1, 0.2, 0.3, 0.5],
  "snapshotUrl": "http://localhost:9000/acs-media/snapshots/...",
  "clipUrl": "http://localhost:9000/acs-media/clips/...",
  "meta": {},
  "ruleName": "Yiqilish - sayt",
  "text": "[CRITICAL] Yiqilish\n..."
}
```

---

## 2. Sizning Node.js backend

### 2.1 Jadval

```sql
CREATE TABLE acs_events (
  id            TEXT PRIMARY KEY,
  camera_id     TEXT NOT NULL,
  camera_name   TEXT,
  type          TEXT NOT NULL,
  severity      TEXT NOT NULL,
  confidence    REAL,
  confirmed_at  TIMESTAMPTZ NOT NULL,
  started_at    TIMESTAMPTZ,
  track_id      INTEGER,
  snapshot_url  TEXT,
  clip_url      TEXT,
  bbox          JSONB,
  meta          JSONB,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX acs_events_confirmed_idx ON acs_events (confirmed_at DESC);
```

### 2.2 Webhook endpoint (Express misol)

```js
// routes/acsWebhook.js
import crypto from "node:crypto";
import express from "express";

const router = express.Router();

// raw body kerak — HMAC uchun. Express da alohida:
// app.use("/api/acs/webhook", express.raw({ type: "application/json" }), ...)

router.post("/api/acs/webhook", async (req, res) => {
  const secret = process.env.ACS_WEBHOOK_SECRET;
  const signature = req.get("x-acs-signature") || "";
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));

  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(signature, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const event = JSON.parse(raw.toString("utf8"));

  await db.query(
    `INSERT INTO acs_events (
       id, camera_id, camera_name, type, severity, confidence,
       confirmed_at, started_at, track_id, snapshot_url, clip_url, bbox, meta
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO NOTHING`,
    [
      event.eventId,
      event.cameraId,
      event.cameraName,
      event.eventType,
      event.severity,
      event.confidence,
      event.confirmedAt,
      event.startedAt,
      event.trackId ?? null,
      event.snapshotUrl ?? null,
      event.clipUrl ?? null,
      event.bbox ? JSON.stringify(event.bbox) : null,
      JSON.stringify(event.meta ?? {}),
    ],
  );

  return res.status(200).json({ ok: true });
});

export default router;
```

### 2.3 Live video proksi (WHEP)

Brauzer ACS ga to'g'ridan-to'g'ri ulanmasin — token serverda qoladi.

```js
// POST /api/cameras/:cameraId/whep
router.post("/api/cameras/:cameraId/whep", async (req, res) => {
  // Bu yerda o'zingizning auth (JWT/session) tekshiruvi
  const { cameraId } = req.params;
  const offer = typeof req.body === "string" ? req.body : await readRawSdp(req);

  const acsUrl = `${process.env.ACS_BASE_URL}/api/streams/${cameraId}/whep`;
  const answer = await fetch(acsUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/sdp",
      Authorization: `Bearer ${process.env.ACS_SERVICE_TOKEN}`,
    },
    body: offer,
  });

  if (!answer.ok) {
    return res.status(answer.status).send(await answer.text());
  }

  res.status(201).type("application/sdp").send(await answer.text());
});
```

`.env` (sizning sayt):

```bash
ACS_BASE_URL=http://localhost:3000
ACS_SERVICE_TOKEN=...   # ACS .env dagi bilan bir xil
ACS_WEBHOOK_SECRET=...  # ACS alert qoidasidagi secret
```

### 2.4 Jadvalni o'qish

```js
// GET /api/acs/events?limit=50
router.get("/api/acs/events", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const rows = await db.query(
    `SELECT * FROM acs_events ORDER BY confirmed_at DESC LIMIT $1`,
    [limit],
  );
  res.json({ events: rows.rows });
});
```

---

## 3. Sizning React frontend

### 3.1 WebRTC player (qisqa)

ACS `WebRtcPlayer` mantiqi: SDP offer → **o'z** `/api/cameras/:id/whep` → answer.

```jsx
// AcsLivePlayer.jsx
import { useEffect, useRef, useState } from "react";

export function AcsLivePlayer({ cameraId }) {
  const videoRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      bundlePolicy: "max-bundle",
    });

    pc.addTransceiver("video", { direction: "recvonly" });
    pc.addTransceiver("audio", { direction: "recvonly" });

    pc.ontrack = (e) => {
      if (videoRef.current) videoRef.current.srcObject = e.streams[0];
    };

    (async () => {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitIce(pc);

        const res = await fetch(`/api/cameras/${cameraId}/whep`, {
          method: "POST",
          headers: { "Content-Type": "application/sdp" },
          body: pc.localDescription.sdp,
          credentials: "include", // o'z saytingiz auth cookie
        });
        if (!res.ok) throw new Error(`WHEP ${res.status}`);
        await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });
      } catch (e) {
        setError(e.message);
      }
    })();

    return () => pc.close();
  }, [cameraId]);

  return (
    <div>
      <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%" }} />
      {error && <p>{error}</p>}
    </div>
  );
}

function waitIce(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === "complete") resolve();
    };
  });
}
```

Kamera UUID ni ACS dashboard → Kameralar ro'yxatidan oling.

### 3.1a Video ustida odam / olov box (canvas)

ACS AI worker har ~200 ms Redis ga box yozadi. Sizning Node shu oqimni
proksi qiladi (Bearer token brauzerga chiqmasin).

**ACS endpointlar:**
- SSE: `GET /api/streams/:cameraId/overlay` (Cookie yoki `Authorization: Bearer`)
- JSON polling: `GET /api/streams/:cameraId/overlay?format=json`

**Payload:**

```json
{
  "cameraId": "uuid",
  "ts": 1720000000.12,
  "boxes": [
    {
      "label": "person",
      "kind": "person",
      "confidence": 0.91,
      "bbox": [0.12, 0.2, 0.18, 0.55],
      "trackId": 7
    },
    {
      "label": "fire",
      "kind": "fire",
      "confidence": 0.84,
      "bbox": [0.4, 0.35, 0.22, 0.3],
      "trackId": null
    }
  ]
}
```

`bbox` = `[x, y, w, h]` video kadriga nisbatan **0..1**.

**Node proksi (SSE):**

```js
// GET /api/cameras/:id/overlay  →  ACS overlay SSE
router.get("/api/cameras/:id/overlay", requireAuth, async (req, res) => {
  const url = `${ACS_BASE}/api/streams/${req.params.id}/overlay`;
  const upstream = await fetch(url, {
    headers: { Authorization: `Bearer ${ACS_SERVICE_TOKEN}` },
  });
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  // Node 18+: ReadableStream pipe
  const reader = upstream.body.getReader();
  const pump = async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  };
  req.on("close", () => reader.cancel());
  pump();
});
```

**React — video + canvas:**

```jsx
// AcsLiveWithBoxes.jsx — player ustiga box chizish
import { useEffect, useRef, useState } from "react";

const COLORS = {
  person: "#22c55e",
  fire: "#ef4444",
  smoke: "#f97316",
  cigarette: "#eab308",
  face: "#38bdf8",
};

export function AcsLiveWithBoxes({ cameraId }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [boxes, setBoxes] = useState([]);

  useEffect(() => {
    const es = new EventSource(`/api/cameras/${cameraId}/overlay`);
    es.addEventListener("overlay", (e) => {
      try {
        setBoxes(JSON.parse(e.data).boxes || []);
      } catch {}
    });
    return () => es.close();
  }, [cameraId]);

  useEffect(() => {
    let id;
    const paint = () => {
      id = requestAnimationFrame(paint);
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;
      const ctx = canvas.getContext("2d");
      const W = video.clientWidth;
      const H = video.clientHeight;
      if (!W || !H) return;
      canvas.width = W;
      canvas.height = H;
      ctx.clearRect(0, 0, W, H);

      // object-contain letterbox
      const vw = video.videoWidth || W;
      const vh = video.videoHeight || H;
      const scale = Math.min(W / vw, H / vh);
      const cw = vw * scale;
      const ch = vh * scale;
      const ox = (W - cw) / 2;
      const oy = (H - ch) / 2;

      for (const b of boxes) {
        const [x, y, w, h] = b.bbox;
        const color = COLORS[b.kind] || "#a3a3a3";
        ctx.strokeStyle = color;
        ctx.lineWidth = b.kind === "fire" ? 3 : 2;
        ctx.strokeRect(ox + x * cw, oy + y * ch, w * cw, h * ch);
        ctx.fillStyle = color;
        ctx.font = "12px sans-serif";
        ctx.fillText(
          `${b.kind} ${Math.round(b.confidence * 100)}%`,
          ox + x * cw,
          oy + y * ch - 4,
        );
      }
    };
    id = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(id);
  }, [boxes]);

  return (
    <div style={{ position: "relative" }}>
      {/* AcsLivePlayer videoRef ni tashqariga bering yoki shu yerda birlashtiring */}
      <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%" }} />
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, pointerEvents: "none", width: "100%", height: "100%" }}
      />
    </div>
  );
}
```

Olov chiqqanda `kind: "fire"` box qizil ramka bilan ko‘rinadi; odam — yashil.

### 3.2 Hodisalar jadvali

```jsx
// AcsEventsTable.jsx
import { useEffect, useState } from "react";

export function AcsEventsTable() {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    fetch("/api/acs/events?limit=50", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setEvents(d.events || []));
  }, []);

  return (
    <table>
      <thead>
        <tr>
          <th>Vaqt</th>
          <th>Kamera</th>
          <th>Turi</th>
          <th>Daraja</th>
          <th>Ishonch</th>
          <th>Snapshot</th>
        </tr>
      </thead>
      <tbody>
        {events.map((e) => (
          <tr key={e.id}>
            <td>{new Date(e.confirmed_at).toLocaleString()}</td>
            <td>{e.camera_name}</td>
            <td>{e.type}</td>
            <td>{e.severity}</td>
            <td>{Math.round((e.confidence || 0) * 100)}%</td>
            <td>
              {e.snapshot_url ? (
                <a href={e.snapshot_url} target="_blank" rel="noreferrer">
                  rasm
                </a>
              ) : (
                "—"
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

Ma'lumot manbai — **faqat sizning DB**. ACS Postgres ga React dan ulanmang.

---

## 4. Tekshirish

1. ACS da kamera online, go2rtc oqim bor
2. Sizning sahifada `AcsLivePlayer` video ko'rsatadi
3. Odam / olov bo‘lsa canvas da box ko‘rinadi (`fire_smoke.pt` model yuklangan bo‘lishi kerak)
4. Webhook URL ni sozlab, ACS da test event (yoki real fall/fire)
5. `acs_events` jadvalida yangi qator
6. `AcsEventsTable` yangilanadi

---

## 5. Nima qilmang

| Qilmang | Sabab |
|---------|--------|
| RTSP ni React ga to'g'ridan-to'g'ri | Brauzer RTSP o'qimaydi |
| AI ni brauzerda ishlatish | 24/7 monitoring yo'qoladi |
| `ACS_SERVICE_TOKEN` ni frontendga berish | Token o'g'irlanadi |
| ACS Postgres ni internetga ochish | Webhook + WHEP proksi yetarli |

---

## 6. Muammolar

| Belgi | Tekshiring |
|-------|------------|
| Video yo'q | ACS da kamera qo'shilganmi? go2rtc stream? `ACS_SERVICE_TOKEN` bir xilmi? |
| Box yo'q | AI worker ishlayaptimi? Redis? `models/fire_smoke.pt` / `person.pt` bormi? Overlay SSE ochiqmi? |
| Webhook 401 | Secret va raw body HMAC — `express.json()` body ni o'zgartirmasin |
| Jadval bo'sh | Alert qoidasi enabled? Event type mosmi? Event-service log |
| Snapshot ochilmaydi | MinIO `S3_PUBLIC_ENDPOINT` tashqi saytdan ochiqmi? |
