"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import type { EventStatus, StoredEvent } from "@acs/types";
import { Badge, Button, SeverityBadge } from "@/components/ui/primitives";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { cn, formatPercent } from "@/lib/utils";

const EVENT_LABELS: Record<string, string> = {
  person_detected: "Odam aniqlandi",
  fire: "Yong'in",
  smoke: "Tutun",
  fall: "Yiqilish",
  smoking: "Chekish",
  zone_intrusion: "Taqiqlangan zonaga kirish",
  loitering: "Uzoq turib qolish",
  camera_offline: "Kamera uzildi",
  camera_online: "Kamera ulandi",
};

const GENDER_LABELS: Record<string, string> = {
  male: "Erkak",
  female: "Ayol",
  unknown: "Noma'lum",
};

const AGE_LABELS: Record<string, string> = {
  young: "Yosh (0-25)",
  middle: "O'rta (26-50)",
  senior: "Katta yosh (51+)",
  unknown: "Noma'lum",
};

export function EventCard({
  event,
  onStatusChange,
}: {
  event: StoredEvent;
  onStatusChange?: (event: StoredEvent) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const setStatus = (status: EventStatus) => {
    startTransition(async () => {
      setError(null);
      const response = await fetch(`/api/events/${event.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        setError("Holatni saqlab bo'lmadi");
        return;
      }

      const data = (await response.json()) as { event: StoredEvent };
      onStatusChange?.(data.event);
    });
  };

  const isBeta = event.meta?.beta === true;
  const resolved = event.status !== "new";

  return (
    <article
      className={cn(
        "panel overflow-hidden transition-opacity",
        resolved && "opacity-60",
        event.severity === "critical" && !resolved && "ring-1 ring-critical/40",
      )}
    >
      <div className="flex gap-3 p-3">
        {event.snapshotUrl ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="relative size-24 shrink-0 overflow-hidden rounded-md bg-black"
            aria-label="Snapshotni kattalashtirish"
          >
            <Image
              src={event.snapshotUrl}
              alt={`${EVENT_LABELS[event.type] ?? event.type} snapshoti`}
              fill
              sizes="96px"
              className="object-cover"
              unoptimized
            />
          </button>
        ) : (
          <div className="grid size-24 shrink-0 place-items-center rounded-md bg-surface-2 text-[10px] text-content-muted">
            Rasm yo&apos;q
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={event.severity} />
            <span className="text-sm font-medium">
              {EVENT_LABELS[event.type] ?? event.type}
            </span>
            {isBeta ? <Badge tone="warning">beta</Badge> : null}
            {event.status === "false_positive" ? (
              <Badge tone="danger">Yolg&apos;on signal</Badge>
            ) : event.status === "acknowledged" ? (
              <Badge tone="brand">Ko&apos;rildi</Badge>
            ) : event.status === "resolved" ? (
              <Badge tone="success">Tasdiqlandi</Badge>
            ) : null}
          </div>

          <p className="mt-1 text-xs text-content-secondary">
            {event.cameraName}
            {event.zoneName ? ` / ${event.zoneName}` : ""}
            {" - "}
            <RelativeTime value={event.confirmedAt} />
          </p>

          <p className="mt-1 text-[11px] text-content-muted">
            Ishonch {formatPercent(event.confidence)}
            {event.trackId !== null ? ` - kuzatuv #${event.trackId}` : ""}
          </p>

          {event.attributes && event.attributes.gender !== "unknown" ? (
            <p className="mt-1 text-[11px] text-content-muted">
              {GENDER_LABELS[event.attributes.gender]} -{" "}
              {AGE_LABELS[event.attributes.ageBucket]}
              {/* Namunalar soni ko'rsatiladi: 2 kadr bo'yicha chiqarilgan
                  xulosaga 40 kadrlik xulosa kabi ishonib bo'lmaydi. */}
              {event.attributes.samples > 0 ? ` (${event.attributes.samples} kadr)` : ""}
            </p>
          ) : null}

          {event.status === "new" ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => setStatus("resolved")}
                className="px-2 py-1 text-xs"
              >
                To&apos;g&apos;ri
              </Button>
              <Button
                variant="danger"
                disabled={pending}
                onClick={() => setStatus("false_positive")}
                className="px-2 py-1 text-xs"
              >
                Yolg&apos;on signal
              </Button>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => setStatus("acknowledged")}
                className="px-2 py-1 text-xs"
              >
                Ko&apos;rdim
              </Button>
            </div>
          ) : null}

          {error ? <p className="mt-2 text-xs text-critical">{error}</p> : null}
        </div>
      </div>

      {expanded && event.snapshotUrl ? (
        <div className="border-t border-surface-2 bg-black">
          <Image
            src={event.snapshotUrl}
            alt=""
            width={1280}
            height={720}
            className="h-auto w-full"
            unoptimized
          />
          {event.clipUrl ? (
            <video src={event.clipUrl} controls className="w-full" preload="none" />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
