"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DetectionOverlay } from "@/components/live/DetectionOverlay";
import { useLiveOverlay } from "@/hooks/useLiveOverlay";
import { cn } from "@/lib/utils";

type PlayerState = "idle" | "connecting" | "playing" | "error";

/**
 * go2rtc dan WHEP orqali WebRTC oqimini oladi.
 *
 * Signalizatsiya o'z API mizdan o'tadi (/api/streams/<id>/whep), go2rtc ga
 * to'g'ridan-to'g'ri emas. Ikki sabab: go2rtc da autentifikatsiya yo'q, va
 * brauzerga uning manzilini oshkor qilish kerak emas. Media oqimining
 * o'zi baribir to'g'ridan-to'g'ri keladi - proksi orqali emas.
 *
 * showOverlay=true bo'lsa AI box lar (odam, olov, ...) canvas da chiziladi.
 */
export function WebRtcPlayer({
  cameraId,
  cameraName,
  muted = true,
  showOverlay = true,
  className,
  onStateChange,
}: {
  cameraId: string;
  cameraName: string;
  muted?: boolean;
  showOverlay?: boolean;
  className?: string;
  onStateChange?: (state: PlayerState) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const connectionRef = useRef<RTCPeerConnection | null>(null);
  const retryRef = useRef<number>(0);
  const [state, setState] = useState<PlayerState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const { overlay, receivedAt } = useLiveOverlay(cameraId, showOverlay && state === "playing");

  const update = useCallback(
    (next: PlayerState, reason?: string) => {
      setState(next);
      setMessage(reason ?? null);
      onStateChange?.(next);
    },
    [onStateChange],
  );

  const connect = useCallback(async () => {
    connectionRef.current?.close();
    update("connecting");

    const connection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      // Kameralar odatda bir xil lokal tarmoqda; bundle rejim ulanishni
      // tezlashtiradi va faqat bitta ICE nomzod to'plami kerak bo'ladi.
      bundlePolicy: "max-bundle",
    });
    connectionRef.current = connection;

    connection.addTransceiver("video", { direction: "recvonly" });
    connection.addTransceiver("audio", { direction: "recvonly" });

    connection.ontrack = (event) => {
      if (videoRef.current && event.streams[0]) {
        videoRef.current.srcObject = event.streams[0];
      }
    };

    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "connected") {
        retryRef.current = 0;
        update("playing");
      } else if (
        connection.connectionState === "failed" ||
        connection.connectionState === "disconnected"
      ) {
        update("error", "Ulanish uzildi");
      }
    };

    try {
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);

      // ICE nomzodlari to'planishini kutamiz: trickle ICE ni qo'llab
      // quvvatlamaydigan WHEP serverlari uchun bu ishonchliroq.
      await waitForIceGathering(connection);

      const response = await fetch(`/api/streams/${cameraId}/whep`, {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: connection.localDescription?.sdp ?? offer.sdp,
      });

      if (!response.ok) {
        let detail = `Server javobi: ${response.status}`;
        try {
          const body = (await response.json()) as { error?: string; detail?: string };
          if (body.error) detail = body.detail ? `${body.error} (${body.detail})` : body.error;
        } catch {
          /* JSON emas */
        }
        throw new Error(
          response.status === 404
            ? "Oqim topilmadi. Kamerani saqlang yoki qayta qo'shing (go2rtc ro'yxati)."
            : detail,
        );
      }

      await connection.setRemoteDescription({
        type: "answer",
        sdp: await response.text(),
      });
    } catch (error) {
      update("error", error instanceof Error ? error.message : "Noma'lum xato");
    }
  }, [cameraId, update]);

  useEffect(() => {
    void connect();
    return () => {
      connectionRef.current?.close();
      connectionRef.current = null;
    };
  }, [connect]);

  // Avtomatik qayta ulanish. Kamera qayta yuklansa yoki tarmoq uzilsa,
  // operator qo'lda yangilashi kerak bo'lmasligi kerak.
  useEffect(() => {
    if (state !== "error") return;

    const delay = Math.min(2000 * 2 ** retryRef.current, 30_000);
    retryRef.current += 1;

    const timer = setTimeout(() => void connect(), delay);
    return () => clearTimeout(timer);
  }, [state, connect]);

  return (
    <div className={cn("relative aspect-video overflow-hidden rounded-lg bg-black", className)}>
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className="size-full object-contain"
        aria-label={`${cameraName} jonli oqimi`}
      />

      {showOverlay && state === "playing" ? (
        <DetectionOverlay videoRef={videoRef} overlay={overlay} receivedAt={receivedAt} />
      ) : null}

      {state !== "playing" ? (
        <div className="absolute inset-0 grid place-items-center bg-surface-0/80 px-4 text-center">
          <div>
            <p className="text-xs font-medium text-content-secondary">
              {state === "connecting" ? "Ulanmoqda..." : "Oqim mavjud emas"}
            </p>
            {message ? (
              <p className="mt-1 text-[11px] text-content-muted">{message}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function waitForIceGathering(connection: RTCPeerConnection, timeoutMs = 2000): Promise<void> {
  if (connection.iceGatheringState === "complete") return Promise.resolve();

  return new Promise((resolve) => {
    const done = () => {
      connection.removeEventListener("icegatheringstatechange", check);
      clearTimeout(timer);
      resolve();
    };

    const check = () => {
      if (connection.iceGatheringState === "complete") done();
    };

    // Ba'zi tarmoqlarda STUN javob bermaydi va to'plash cheksiz davom
    // etadi. Lokal nomzodlar odatda yetarli, shuning uchun timeout.
    const timer = setTimeout(done, timeoutMs);
    connection.addEventListener("icegatheringstatechange", check);
  });
}
