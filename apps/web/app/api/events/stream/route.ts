import type { NextRequest } from "next/server";
import type { StoredEvent } from "@acs/types";
import { apiSession } from "@/lib/auth/guard";
import { listEvents } from "@/lib/data/events";

export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 20_000;

/**
 * Hodisalar oqimi (SSE).
 *
 * Bu yerda Redis ga obuna bo'lish o'rniga bazadan davriy o'qish
 * ishlatilgan. Sabab: eventlar tezligi past (soatiga o'nlab, minglab
 * emas), 2 soniyalik kechikish operator uchun sezilmaydi, va bu yechim
 * Next.js ning bir necha nusxasi ishlayotganda ham to'g'ri ishlaydi -
 * har bir nusxa mustaqil o'qiydi, xabarni "kim oldi" muammosi yo'q.
 *
 * Agar kelajakda soniyasiga o'nlab event bo'lsa, bu yerni Redis
 * pub/sub ga o'tkazish kerak bo'ladi.
 */
export async function GET(request: NextRequest) {
  const auth = await apiSession("event:read");
  if ("response" in auth) return auth.response;

  const { orgId } = auth.session;
  const encoder = new TextEncoder();

  let cursor = new Date();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      // Ulanish o'rnatilganini darhol bildiramiz, aks holda klient
      // birinchi event kelguncha "ulanmoqda" holatida qoladi.
      send("ready", { at: cursor.toISOString() });

      const poll = setInterval(async () => {
        try {
          const events = await listEvents(orgId, { from: cursor, limit: 50 });
          if (events.length === 0) return;

          // Eng yangi event vaqti keyingi so'rov chegarasi bo'ladi.
          // 1 ms qo'shiladi, aks holda o'sha event qayta keladi.
          const newest = events[0] as StoredEvent;
          cursor = new Date(new Date(newest.confirmedAt).getTime() + 1);

          for (const event of events.toReversed()) {
            send("detection", event);
          }
        } catch (error) {
          console.error("SSE polling xatosi:", error);
        }
      }, POLL_INTERVAL_MS);

      // Proksilar bo'sh ulanishni 30-60 soniyada uzadi. Kommentariy
      // qatori ulanishni tirik saqlaydi va klientda hech narsa keltirib
      // chiqarmaydi.
      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": ping\n\n"));
      }, HEARTBEAT_INTERVAL_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(poll);
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Klient allaqachon uzilgan bo'lishi mumkin.
        }
      };

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // nginx bufer qilmasligi uchun.
      "X-Accel-Buffering": "no",
    },
  });
}
