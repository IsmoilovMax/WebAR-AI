import type { NextRequest } from "next/server";
import { apiSessionOrServiceToken } from "@/lib/auth/guard";
import { getCamera, getCameraById } from "@/lib/data/cameras";
import {
  getRedis,
  overlayChannel,
  overlayLatestKey,
} from "@/lib/redis";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Jonli detection box lar (SSE).
 *
 * AI worker Redis pub/sub ga ~5 Hz yozadi. Brauzer canvas shu oqimdan
 * odam / olov / tutun ramkalarini video ustiga chizadi.
 *
 * Auth: cookie sessiya YOKI Bearer ACS_SERVICE_TOKEN (Node BFF).
 * Eslatma: brauzer EventSource Bearer yubora olmaydi — tashqi sayt
 * o'z Node orqali proksi qilsin.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ cameraId: string }> },
) {
  const auth = await apiSessionOrServiceToken(request, "camera:read");
  if ("response" in auth) return auth.response;

  const { cameraId } = await context.params;

  const camera =
    auth.kind === "service"
      ? await getCameraById(cameraId)
      : await getCamera(auth.session.orgId, cameraId);

  if (!camera) {
    return Response.json({ error: "Kamera topilmadi" }, { status: 404 });
  }

  // Oddiy polling: ?format=json — Node BFF uchun qulay.
  if (request.nextUrl.searchParams.get("format") === "json") {
    try {
      const redis = await getRedis();
      const raw = await redis.get(overlayLatestKey(cameraId));
      if (!raw) {
        return Response.json({ cameraId, ts: 0, boxes: [] });
      }
      return Response.json(JSON.parse(raw));
    } catch {
      return Response.json(
        { error: "Redis mavjud emas" },
        { status: 502 },
      );
    }
  }

  const encoder = new TextEncoder();
  let closed = false;
  let subscriber: Awaited<ReturnType<typeof getRedis>> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      send("ready", { cameraId, at: Date.now() });

      try {
        const redis = await getRedis();
        const latest = await redis.get(overlayLatestKey(cameraId));
        if (latest) {
          send("overlay", JSON.parse(latest));
        }

        subscriber = redis.duplicate();
        await subscriber.connect();
        await subscriber.subscribe(overlayChannel(cameraId), (message) => {
          try {
            send("overlay", JSON.parse(message));
          } catch {
            // Buzilgan xabar oqimni to'xtatmasin.
          }
        });
      } catch (error) {
        console.error("Overlay SSE Redis xatosi:", error);
        send("error", { message: "Redis ulanmadi" });
      }

      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": ping\n\n"));
      }, HEARTBEAT_INTERVAL_MS);

      const cleanup = async () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        try {
          if (subscriber?.isOpen) {
            await subscriber.unsubscribe(overlayChannel(cameraId));
            await subscriber.quit();
          }
        } catch {
          // ignore
        }
        try {
          controller.close();
        } catch {
          // Klient allaqachon uzilgan.
        }
      };

      request.signal.addEventListener("abort", () => {
        void cleanup();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
