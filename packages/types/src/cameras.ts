import { z } from "zod";

/** Har bir detektor mustaqil yoqiladi - GPU byudjeti cheklangan. */
export const DETECTORS = ["person", "fire_smoke", "fall", "smoking", "demographics"] as const;
export type Detector = (typeof DETECTORS)[number];

export const DETECTOR_LABELS: Record<Detector, string> = {
  person: "Odam aniqlash",
  fire_smoke: "Yong'in va tutun",
  fall: "Yiqilish",
  smoking: "Chekish (beta)",
  demographics: "Jins va yosh guruhi",
};

/**
 * Chekish detektori ilmiy maqolalarda ham 72-84% aniqlik beradi (sigaret juda
 * kichik obyekt). Shuning uchun UI da beta deb belgilanadi.
 */
export const BETA_DETECTORS: readonly Detector[] = ["smoking"];

export const ZONE_KINDS = ["include", "exclude", "no_smoking", "restricted"] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

/** Poligon nuqtalari normallashtirilgan (0..1), shuning uchun rezolyutsiyaga bog'liq emas. */
export const polygonSchema = z
  .array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]))
  .min(3);

export type Polygon = z.infer<typeof polygonSchema>;

export const detectionZoneSchema = z.object({
  id: z.string().uuid(),
  cameraId: z.string().uuid(),
  name: z.string().min(1).max(120),
  kind: z.enum(ZONE_KINDS),
  polygon: polygonSchema,
  detectors: z.array(z.enum(DETECTORS)).default([]),
});

export type DetectionZone = z.infer<typeof detectionZoneSchema>;

export const cameraStatuses = ["online", "offline", "degraded", "disabled"] as const;
export type CameraStatus = (typeof cameraStatuses)[number];

export const cameraInputSchema = z.object({
  /** HTML select bo'sh qiymat "" yuboradi — null ga aylantiramiz. */
  siteId: z.preprocess(
    (val) => (val === "" || val === undefined || val === null ? null : val),
    z.string().uuid().nullable(),
  ),
  name: z.string().min(1).max(120),
  /** Hikvision ISAPI host, masalan 192.168.1.64 */
  host: z.string().min(1).max(255),
  rtspPort: z.number().int().min(1).max(65535).default(554),
  isapiPort: z.number().int().min(1).max(65535).default(80),
  channel: z.number().int().min(1).max(64).default(1),
  username: z.string().min(1).max(120),
  /** Faqat yozishda yuboriladi, hech qachon o'qishda qaytmaydi. */
  password: z.string().min(1).max(255),
  enabledDetectors: z.array(z.enum(DETECTORS)).default(["person"]),
  /** AI uchun tahlil qilinadigan kadr chastotasi. 5-8 fps aksariyat hollarda yetarli. */
  analyticsFps: z.number().min(1).max(30).default(6),
  enabled: z.boolean().default(true),
});

export type CameraInput = z.infer<typeof cameraInputSchema>;

export interface Camera {
  id: string;
  orgId: string;
  siteId: string | null;
  siteName: string | null;
  name: string;
  host: string;
  rtspPort: number;
  isapiPort: number;
  channel: number;
  username: string;
  enabledDetectors: Detector[];
  analyticsFps: number;
  enabled: boolean;
  status: CameraStatus;
  lastSeenAt: string | null;
  /** go2rtc stream nomi, WebRTC ijro uchun. */
  streamName: string;
  createdAt: string;
}

/**
 * Hikvision RTSP URL sxemasi.
 * Kanal ID = channel * 100 + stream (1 = main, 2 = sub).
 * AI har doim sub-stream ni oladi: 640x480 yetarli va GPU ni tejaydi.
 */
export function buildRtspUrl(
  camera: Pick<Camera, "host" | "rtspPort" | "channel"> & { username: string; password: string },
  stream: "main" | "sub",
): string {
  const channelId = camera.channel * 100 + (stream === "main" ? 1 : 2);
  const credentials = `${encodeURIComponent(camera.username)}:${encodeURIComponent(camera.password)}`;
  return `rtsp://${credentials}@${camera.host}:${camera.rtspPort}/Streaming/Channels/${channelId}`;
}

/** go2rtc stream nomlari kamera ID ga bog'lanadi, shunda konfiguratsiya barqaror bo'ladi. */
export function streamName(cameraId: string, stream: "main" | "sub"): string {
  return `cam_${cameraId.replace(/-/g, "")}_${stream}`;
}
