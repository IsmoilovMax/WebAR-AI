"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Camera, EventSeverity, EventStatus, EventType, StoredEvent } from "@acs/types";
import { EVENT_TYPES } from "@acs/types";
import { Button, EmptyState, Panel, Select, StatusDot } from "@/components/ui/primitives";
import { useEventStream } from "@/hooks/useEventStream";
import { EventCard } from "./EventCard";

const TYPE_LABELS: Record<EventType, string> = {
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

const STATUS_OPTIONS: { value: EventStatus | "all"; label: string }[] = [
  { value: "new", label: "Ko'rilmagan" },
  { value: "all", label: "Barchasi" },
  { value: "acknowledged", label: "Ko'rilgan" },
  { value: "resolved", label: "Tasdiqlangan" },
  { value: "false_positive", label: "Yolg'on signal" },
];

const SEVERITY_OPTIONS: { value: EventSeverity | "all"; label: string }[] = [
  { value: "all", label: "Har qanday muhimlik" },
  { value: "critical", label: "Kritik" },
  { value: "high", label: "Yuqori" },
  { value: "medium", label: "O'rta" },
  { value: "low", label: "Past" },
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

  // Jonli oqimdan kelgan yangi hodisalar ro'yxat boshiga qo'shiladi.
  // Filtrlash klient tomonda: server so'rovini takrorlash kechikish
  // beradi va operator yangi signalni kech ko'radi.
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
  }, [events]);

  const replaceEvent = useCallback((updated: StoredEvent) => {
    setEvents((previous) =>
      previous.map((event) => (event.id === updated.id ? updated : event)),
    );
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <Panel className="flex flex-wrap items-center gap-2 p-3">
        <Select
          aria-label="Holat bo'yicha filtr"
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
          aria-label="Muhimlik bo'yicha filtr"
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
          aria-label="Tur bo'yicha filtr"
          value={filters.type}
          onChange={(e) =>
            setFilters((f) => ({ ...f, type: e.target.value as Filters["type"] }))
          }
          className="w-auto"
        >
          <option value="all">Har qanday tur</option>
          {EVENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABELS[type]}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Kamera bo'yicha filtr"
          value={filters.camera}
          onChange={(e) => setFilters((f) => ({ ...f, camera: e.target.value }))}
          className="w-auto"
        >
          <option value="all">Barcha kameralar</option>
          {cameras.map((camera) => (
            <option key={camera.id} value={camera.id}>
              {camera.name}
            </option>
          ))}
        </Select>

        <div className="ml-auto">
          <StatusDot
            status={state === "open" ? "online" : state === "connecting" ? "degraded" : "offline"}
            label={state === "open" ? "Jonli" : "Uzilgan"}
          />
        </div>
      </Panel>

      {visible.length === 0 ? (
        <EmptyState
          title="Hodisa yo'q"
          description="Tanlangan filtrlar bo'yicha hodisa topilmadi. Filtrlarni kengaytiring yoki kameralar ishlayotganini tekshiring."
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
          {loading ? "Yuklanmoqda..." : "Yana yuklash"}
        </Button>
      ) : null}
    </div>
  );
}
