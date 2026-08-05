"use client";

import { useEffect, useState } from "react";
import type { LiveOverlay } from "@acs/types";

/**
 * Kamera uchun jonli detection box lar (SSE).
 * receivedAt — brauzer vaqti; overlay.ts server soatiga bog'liq emas.
 */
export function useLiveOverlay(cameraId: string, enabled = true) {
  const [overlay, setOverlay] = useState<LiveOverlay | null>(null);
  const [receivedAt, setReceivedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setOverlay(null);
      setReceivedAt(null);
      return;
    }

    const source = new EventSource(`/api/streams/${cameraId}/overlay`);

    source.addEventListener("overlay", (message) => {
      try {
        const data = JSON.parse(
          (message as MessageEvent<string>).data,
        ) as LiveOverlay;
        setOverlay(data);
        setReceivedAt(Date.now());
      } catch {
        // ignore
      }
    });

    source.onerror = () => {
      // EventSource qayta ulanadi; eski boxlar TTL bilan o'chadi.
    };

    return () => {
      source.close();
    };
  }, [cameraId, enabled]);

  return { overlay, receivedAt };
}
