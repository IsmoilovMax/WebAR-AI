"use client";

import { useEffect, useRef, useState } from "react";
import type { StoredEvent } from "@acs/types";

type ConnectionState = "connecting" | "open" | "closed";

/**
 * /api/events/stream ga ulanadi va yangi hodisalarni qaytaradi.
 *
 * EventSource o'zi qayta ulanadi, ammo server 401 qaytarsa u cheksiz
 * urinaveradi. Shuning uchun xato holati alohida kuzatiladi.
 */
export function useEventStream(limit = 100) {
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [state, setState] = useState<ConnectionState>("connecting");
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/events/stream");
    sourceRef.current = source;

    source.addEventListener("ready", () => setState("open"));

    source.addEventListener("detection", (message) => {
      try {
        const event = JSON.parse((message as MessageEvent<string>).data) as StoredEvent;
        setEvents((previous) => {
          if (previous.some((item) => item.id === event.id)) return previous;
          return [event, ...previous].slice(0, limit);
        });
      } catch {
        // Buzilgan xabar butun oqimni to'xtatmasligi kerak.
      }
    });

    source.onerror = () => {
      setState(source.readyState === EventSource.CLOSED ? "closed" : "connecting");
    };

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, [limit]);

  return { events, state };
}
