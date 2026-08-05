import "server-only";

import { buildRtspUrl, streamName, type Camera } from "@acs/types";
import { serverEnv } from "../env";

/**
 * go2rtc oqim registri.
 *
 * Oqimlar konfiguratsiya faylida emas, API orqali boshqariladi: kamera
 * qo'shilganda go2rtc ni qayta ishga tushirish kerak emas va boshqa
 * kameralarning ko'rinishi uzilmaydi.
 *
 * Diqqat: go2rtc da autentifikatsiya yo'q. U faqat ichki tarmoqda ochiq
 * bo'lishi kerak; brauzerga WebRTC signalizatsiya shu servisdan o'tadi.
 */

interface RegisterOptions {
  camera: Pick<Camera, "id" | "host" | "rtspPort" | "channel" | "username">;
  password: string;
}

/** Jonli video oqimi: main sifatli, sub — ko'p kamera grid uchun yengil. */
export function liveStreamTier(): "main" | "sub" {
  return process.env.ACS_LIVE_STREAM === "sub" ? "sub" : "main";
}

export function liveStreamName(cameraId: string): string {
  return streamName(cameraId, liveStreamTier());
}

export function archiveStreamName(cameraId: string): string {
  return streamName(cameraId, "main");
}

/** Main stream H.265 bo'lishi mumkin — WebRTC/AI uchun H.264 ga transkod. */
function go2rtcSource(rtspUrl: string, tier: "main" | "sub"): string {
  if (tier === "main") {
    return `ffmpeg:${rtspUrl}#video=h264`;
  }
  return rtspUrl;
}

async function put(name: string, source: string): Promise<void> {
  const url = new URL("/api/streams", serverEnv().GO2RTC_URL);
  url.searchParams.set("name", name);
  url.searchParams.set("src", source);

  const response = await fetch(url, { method: "PUT" });
  if (!response.ok) {
    throw new Error(`go2rtc oqimini ro'yxatdan o'tkazib bo'lmadi (${response.status})`);
  }
}

export async function registerStreams({ camera, password }: RegisterOptions): Promise<void> {
  const credentials = { ...camera, password };

  // Ikkala oqim ham doimo ro'yxatdan o'tadi; jonli ko'rinish ACS_LIVE_STREAM
  // orqali tanlanadi (video va AI bir xil tier ishlatishi kerak).
  await Promise.all([
    put(streamName(camera.id, "sub"), go2rtcSource(buildRtspUrl(credentials, "sub"), "sub")),
    put(streamName(camera.id, "main"), go2rtcSource(buildRtspUrl(credentials, "main"), "main")),
  ]);
}

export async function unregisterStreams(cameraId: string): Promise<void> {
  const base = serverEnv().GO2RTC_URL;

  await Promise.allSettled(
    [streamName(cameraId, "sub"), streamName(cameraId, "main")].map((name) => {
      const url = new URL("/api/streams", base);
      url.searchParams.set("name", name);
      return fetch(url, { method: "DELETE" });
    }),
  );
}

export interface StreamHealth {
  online: boolean;
  producers: number;
  consumers: number;
}

export async function streamHealth(cameraId: string): Promise<StreamHealth> {
  try {
    const url = new URL("/api/streams", serverEnv().GO2RTC_URL);
    url.searchParams.set("src", liveStreamName(cameraId));

    const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    if (!response.ok) return { online: false, producers: 0, consumers: 0 };

    const data = (await response.json()) as {
      producers?: unknown[];
      consumers?: unknown[];
    };

    return {
      online: (data.producers?.length ?? 0) > 0,
      producers: data.producers?.length ?? 0,
      consumers: data.consumers?.length ?? 0,
    };
  } catch {
    return { online: false, producers: 0, consumers: 0 };
  }
}
