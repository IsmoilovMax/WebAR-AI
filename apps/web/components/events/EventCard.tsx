"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import type { EventStatus, StoredEvent } from "@acs/types";
import { Badge, Button, SeverityBadge } from "@/components/ui/primitives";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { cn, formatPercent } from "@/lib/utils";

const EVENT_LABELS: Record<string, string> = {
  person_detected: "얼굴 인식",
  fire: "화재",
  smoke: "연기",
  fall: "낙상",
  smoking: "흡연",
  zone_intrusion: "구역 침입",
  loitering: "배회",
  camera_offline: "카메라 오프라인",
  camera_online: "카메라 온라인",
};

const GENDER_LABELS: Record<string, string> = {
  male: "남자",
  female: "여자",
  unknown: "미확인",
};

const AGE_LABELS: Record<string, string> = {
  young: "어린이",
  middle: "중년",
  senior: "노인",
  unknown: "미확인",
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
        setError("상태를 저장할 수 없습니다");
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
            className="relative size-24 shrink-0 overflow-hidden rounded bg-black"
            aria-label="스냅샷 확대"
          >
            <Image
              src={event.snapshotUrl}
              alt={`${EVENT_LABELS[event.type] ?? event.type} 스냅샷`}
              fill
              sizes="96px"
              className="object-cover"
              unoptimized
            />
          </button>
        ) : (
          <div className="grid size-24 shrink-0 place-items-center rounded bg-surface-2 text-[10px] text-content-muted">
            이미지 없음
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={event.severity} />
            <span className="text-sm font-medium">
              {EVENT_LABELS[event.type] ?? event.type}
            </span>
            {isBeta ? <Badge tone="warning">베타</Badge> : null}
            {event.status === "false_positive" ? (
              <Badge tone="danger">오탐</Badge>
            ) : event.status === "acknowledged" ? (
              <Badge tone="brand">확인됨</Badge>
            ) : event.status === "resolved" ? (
              <Badge tone="success">처리됨</Badge>
            ) : null}
          </div>

          <p className="mt-1 text-xs text-content-secondary">
            {event.cameraName}
            {event.zoneName ? ` / ${event.zoneName}` : ""}
            {" · "}
            <RelativeTime value={event.confirmedAt} />
          </p>

          <p className="mt-1 text-[11px] text-content-muted">
            신뢰도 {formatPercent(event.confidence)}
            {event.trackId !== null ? ` · 추적 #${event.trackId}` : ""}
          </p>

          {event.attributes && event.attributes.gender !== "unknown" ? (
            <p className="mt-1 text-[11px] text-content-muted">
              {GENDER_LABELS[event.attributes.gender]} ·{" "}
              {AGE_LABELS[event.attributes.ageBucket]}
              {event.attributes.samples > 0 ? ` (${event.attributes.samples}프레임)` : ""}
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
                정상
              </Button>
              <Button
                variant="danger"
                disabled={pending}
                onClick={() => setStatus("false_positive")}
                className="px-2 py-1 text-xs"
              >
                오탐
              </Button>
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => setStatus("acknowledged")}
                className="px-2 py-1 text-xs"
              >
                확인
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
