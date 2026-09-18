"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Camera, EventSeverity, EventStatus, EventType, StoredEvent } from "@acs/types";
import { EVENT_TYPES } from "@acs/types";
import { Button, EmptyState, Panel, Select, StatusDot } from "@/components/ui/primitives";
import { useEventStream } from "@/hooks/useEventStream";
import { EventCard } from "./EventCard";

const TYPE_LABELS: Record<EventType, string> = {
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

const STATUS_OPTIONS: { value: EventStatus | "all"; label: string }[] = [
  { value: "new", label: "미확인" },
  { value: "all", label: "전체" },
  { value: "acknowledged", label: "확인됨" },
  { value: "resolved", label: "처리됨" },
  { value: "false_positive", label: "오탐" },
];

const SEVERITY_OPTIONS: { value: EventSeverity | "all"; label: string }[] = [
  { value: "all", label: "모든 심각도" },
  { value: "critical", label: "긴급" },
  { value: "high", label: "높음" },
  { value: "medium", label: "보통" },
  { value: "low", label: "낮음" },
];

interface Filters {
  status: EventStatus | "all";
  severity: EventSeverity | "all";
  type: EventType | "all";
  camera: string | "all";
}

export function EventFeed({
  initialEvents,
  cameras,
  initialStatus = "new",
}: {
  initialEvents: StoredEvent[];
  cameras: Camera[];
  initialStatus?: EventStatus | "all";
}) {
  const [events, setEvents] = useState(initialEvents);
  const [filters, setFilters] = useState<Filters>({
    status: initialStatus,
    severity: "all",
    type: "all",
    camera: "all",
  });
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(initialEvents.length === 0);

  const { events: liveEvents, state } = useEventStream(50);

  useEffect(() => {
    if (liveEvents.length === 0) return;

    setEvents((previous) => {
      const known = new Set(previous.map((event) => event.id));
      const fresh = liveEvents.filter((event) => !known.has(event.id));
      if (fresh.length === 0) return previous;
      return [...fresh, ...previous];
    });
  }, [liveEvents]);

  const visible = useMemo(() => {
    return events.filter((event) => {
      if (filters.status !== "all" && event.status !== filters.status) return false;
      if (filters.severity !== "all" && event.severity !== filters.severity) return false;
      if (filters.type !== "all" && event.type !== filters.type) return false;
      if (
        filters.type === "all" &&
        (event.type === "camera_online" || event.type === "camera_offline")
      ) {
        return false;
      }
      if (filters.camera !== "all" && event.cameraId !== filters.camera) return false;
      return true;
    });
  }, [events, filters]);

  const loadMore = useCallback(async () => {
    const oldest = events.at(-1);
    if (!oldest) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({ before: oldest.confirmedAt, limit: "50" });
      if (filters.status !== "all") params.set("status", filters.status);
      if (filters.severity !== "all") params.set("severity", filters.severity);
      if (filters.type !== "all") params.set("type", filters.type);
      if (filters.camera !== "all") params.set("camera", filters.camera);

      const response = await fetch(`/api/events?${params}`);
      if (!response.ok) return;

      const data = (await response.json()) as { events: StoredEvent[] };
      if (data.events.length === 0) {
        setExhausted(true);
        return;
      }

      setEvents((previous) => [...previous, ...data.events]);
    } finally {
      setLoading(false);
    }
  }, [events, filters]);

  const replaceEvent = useCallback((updated: StoredEvent) => {
    setEvents((previous) =>
      previous.map((event) => (event.id === updated.id ? updated : event)),
    );
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <Panel className="flex flex-wrap items-center gap-2 p-3">
        <Select
          aria-label="상태 필터"
          value={filters.status}
          onChange={(e) =>
            setFilters((f) => ({ ...f, status: e.target.value as Filters["status"] }))
          }
          className="w-auto"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        <Select
          aria-label="심각도 필터"
          value={filters.severity}
          onChange={(e) =>
            setFilters((f) => ({ ...f, severity: e.target.value as Filters["severity"] }))
          }
          className="w-auto"
        >
          {SEVERITY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>

        <Select
          aria-label="유형 필터"
          value={filters.type}
          onChange={(e) =>
            setFilters((f) => ({ ...f, type: e.target.value as Filters["type"] }))
          }
          className="w-auto"
        >
          <option value="all">모든 유형</option>
          {EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABELS[type]}
            </option>
          ))}
        </Select>

        <Select
          aria-label="카메라 필터"
          value={filters.camera}
          onChange={(e) => setFilters((f) => ({ ...f, camera: e.target.value }))}
          className="w-auto"
        >
          <option value="all">모든 카메라</option>
          {cameras.map((camera) => (
            <option key={camera.id} value={camera.id}>
              {camera.name}
            </option>
          ))}
        </Select>

        <div className="ml-auto">
          <StatusDot
            status={state === "open" ? "online" : state === "connecting" ? "degraded" : "offline"}
            label={state === "open" ? "실시간" : "연결 끊김"}
          />
        </div>
      </Panel>

      {visible.length === 0 ? (
        <EmptyState
          title="이벤트 없음"
          description={
            events.length > 0
              ? "필터에 맞는 이벤트가 없습니다. '전체' 또는 다른 유형을 선택하세요."
              : "선택한 필터에 해당하는 이벤트가 없습니다. 필터를 넓히거나 카메라 상태를 확인하세요."
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((event) => (
            <EventCard key={event.id} event={event} onStatusChange={replaceEvent} />
          ))}
        </div>
      )}

      {!exhausted && events.length > 0 ? (
        <Button onClick={loadMore} disabled={loading} className="self-center">
          {loading ? "로딩 중..." : "더 보기"}
        </Button>
      ) : null}
    </div>
  );
}
