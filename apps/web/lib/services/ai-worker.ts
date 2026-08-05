import "server-only";

import { serverEnv } from "../env";

export interface WorkerCameraStatus {
  cameraId: string;
  connected: boolean;
  statusReason: string | null;
  framesProcessed: number;
  eventsPublished: number;
  lastFrameAt: number | null;
  inferenceMs: number;
  activeDetectors: string[];
  disabledDetectors: Record<string, string>;
}

export interface WorkerStatus {
  device: string;
  modelErrors: Record<string, string>;
  modelVersions: Record<string, string>;
  bus: { published: number; failed: number };
  cameras: WorkerCameraStatus[];
}

function authHeaders(): HeadersInit {
  const token = serverEnv().AI_WORKER_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Worker holati. Worker pastga tushgan bo'lsa null qaytaradi - dashboard
 * shunda ham ochilishi kerak, faqat "AI servisi javob bermayapti" deb
 * ko'rsatadi.
 *
 * Online tekshiruv /health orqali (token shart emas). /status batafsil
 * ma'lumot; 401/timeout bo'lsa ham servis tirik deb badge yashil bo'ladi.
 */
export async function fetchWorkerStatus(): Promise<WorkerStatus | null> {
  const base = serverEnv().AI_WORKER_URL;

  try {
    const health = await fetch(new URL("/health", base), {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!health.ok) return null;
  } catch {
    return null;
  }

  try {
    const response = await fetch(new URL("/status", base), {
      headers: authHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      return (await response.json()) as WorkerStatus;
    }
  } catch {
    // Token yoki sekinlik — pastroqda stub qaytaramiz.
  }

  return {
    device: "unknown",
    modelErrors: {},
    modelVersions: {},
    bus: { published: 0, failed: 0 },
    cameras: [],
  };
}

/**
 * Kamera yoki zona o'zgargandan keyin chaqiriladi.
 *
 * Xato yutiladi: worker 30 soniyada o'zi ham yangilanadi, shuning uchun
 * bu chaqiruvning muvaffaqiyatsizligi foydalanuvchi amalini bekor qilishi
 * mantiqsiz bo'lardi.
 */
export async function notifyWorkerReload(): Promise<boolean> {
  try {
    const response = await fetch(new URL("/reload", serverEnv().AI_WORKER_URL), {
      method: "POST",
      headers: authHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
