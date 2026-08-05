"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Camera, StoredEvent } from "@acs/types";
import { EmptyState, SeverityBadge, StatusDot } from "@/components/ui/primitives";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { useEventStream } from "@/hooks/useEventStream";
import { cn } from "@/lib/utils";
import { WebRtcPlayer } from "./WebRtcPlayer";

const EVENT_LABELS: Record<string, string> = {
  person_detected: "Odam",
  fire: "Yong'in",
  smoke: "Tutun",
  fall: "Yiqilish",
  smoking: "Chekish",
  zone_intrusion: "Zonaga kirish",
  loitering: "Uzoq turish",
  camera_offline: "Kamera uzildi",
  camera_online: "Kamera ulandi",
};

// Overlay shu vaqtdan keyin yo'qoladi. Operator kadrni ko'rib ulgurishi
// kerak, ammo eski signal doimiy turmasligi ham kerak.
const OVERLAY_TTL_MS = 30_000;

export function LiveGrid({ cameras }: { cameras: Camera[] }) {
  const { events, state } = useEventStream(60);
  const [columns, setColumns] = useState(2);

  const latestByCamera = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, StoredEvent>();

    for (const event of events) {
      if (event.type === "camera_online" || event.type === "camera_offline") continue;
      if (now - new Date(event.confirmedAt).getTime() > OVERLAY_TTL_MS) continue;
      if (!map.has(event.cameraId)) map.set(event.cameraId, event);
    }

    return map;
  }, [events]);

  if (cameras.length === 0) {
    return (
      <EmptyState
        title="Kamera qo'shilmagan"
        description="Boshlash uchun Hikvision kamerangizni qo'shing. Kamera qo'shishdan oldin ISAPI ulanishini tekshirib oling."
        action={
          <Link
            href="/cameras"
            className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-surface-0"
          >
            Kamera qo'shish
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <StatusDot
          status={state === "open" ? "online" : state === "connecting" ? "degraded" : "offline"}
          label={
            state === "open"
              ? "Hodisalar oqimi faol"
              : state === "connecting"
                ? "Ulanmoqda..."
                : "Oqim uzildi"
          }
        />

        <div className="flex items-center gap-1" role="group" aria-label="Grid o'lchami">
          {[1, 2, 3].map((count) => (
            <button
              key={count}
              type="button"
              onClick={() => setColumns(count)}
              aria-pressed={columns === count}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                columns === count
                  ? "bg-brand/15 text-brand"
                  : "text-content-muted hover:bg-surface-2",
              )}
            >
              {count}x
            </button>
          ))}
        </div>
      </div>

      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {cameras.map((camera) => (
          <CameraTile
            key={camera.id}
            camera={camera}
            event={latestByCamera.get(camera.id) ?? null}
          />
        ))}
      </div>
    </div>
  );
}

function CameraTile({ camera, event }: { camera: Camera; event: StoredEvent | null }) {
  const critical = event?.severity === "critical";

  return (
    <article
      className={cn(
        "panel overflow-hidden",
        critical && "ring-1 ring-critical pulse-critical",
      )}
    >
      <div className="relative">
        <WebRtcPlayer cameraId={camera.id} cameraName={camera.name} />

        {event ? (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/85 to-transparent px-3 pb-2 pt-6">
            <SeverityBadge severity={event.severity} />
            <span className="text-xs font-medium text-white">
              {EVENT_LABELS[event.type] ?? event.type}
            </span>
            <RelativeTime
              value={event.confirmedAt}
              className="ml-auto text-[11px] text-white/70"
            />
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">{camera.name}</p>
          {camera.siteName ? (
            <p className="truncate text-[11px] text-content-muted">{camera.siteName}</p>
          ) : null}
        </div>
        <StatusDot status={camera.status} />
      </div>
    </article>
  );
}
