import { z } from "zod";

/**
 * Event shartnomasi. Python AI worker aynan shu JSON ni Redis Stream ga yozadi,
 * event-service uni Postgres ga saqlaydi, web esa SSE orqali o'qiydi.
 * Bu yerdagi har qanday o'zgarish services/ai-worker/app/schemas.py bilan
 * bir vaqtda qilinishi kerak.
 */

export const EVENT_TYPES = [
  "person_detected",
  "fire",
  "smoke",
  "fall",
  "smoking",
  "zone_intrusion",
  "loitering",
  "camera_offline",
  "camera_online",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_SEVERITIES = ["info", "low", "medium", "high", "critical"] as const;
export type EventSeverity = (typeof EVENT_SEVERITIES)[number];

export const EVENT_STATUSES = ["new", "acknowledged", "resolved", "false_positive"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const GENDERS = ["male", "female", "unknown"] as const;
export type Gender = (typeof GENDERS)[number];

/**
 * Yosh guruhlari. Aniq raqam ataylab berilmaydi: eng yaxshi ochiq modellarda
 * ham MAE ~7.5 yil, ya'ni bitta raqam ishonchsiz. Faqat keng guruh beriladi.
 */
export const AGE_BUCKETS = ["young", "middle", "senior", "unknown"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];

export const AGE_BUCKET_RANGES: Record<Exclude<AgeBucket, "unknown">, [number, number]> = {
  young: [0, 25],
  middle: [26, 50],
  senior: [51, 120],
};

/** Normallashtirilgan bbox: [x, y, w, h], hammasi 0..1 oralig'ida. */
export const bboxSchema = z.tuple([
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
  z.number().min(0).max(1),
]);

export type BBox = z.infer<typeof bboxSchema>;

export const personAttributesSchema = z.object({
  gender: z.enum(GENDERS).default("unknown"),
  genderConfidence: z.number().min(0).max(1).default(0),
  ageBucket: z.enum(AGE_BUCKETS).default("unknown"),
  ageConfidence: z.number().min(0).max(1).default(0),
  /** Nechta kadr bo'yicha ovoz berilgan. Kam bo'lsa - ishonch past. */
  samples: z.number().int().nonnegative().default(0),
});

export type PersonAttributes = z.infer<typeof personAttributesSchema>;

export const detectionEventSchema = z.object({
  /** Worker tomonidan yaratilgan idempotentlik kaliti. */
  eventKey: z.string().min(1),
  orgId: z.string().uuid(),
  cameraId: z.string().uuid(),
  type: z.enum(EVENT_TYPES),
  severity: z.enum(EVENT_SEVERITIES),
  /** ISO 8601, UTC. Event boshlangan payt. */
  startedAt: z.string().datetime(),
  /** Temporal qoida tasdiqlangan payt. */
  confirmedAt: z.string().datetime(),
  confidence: z.number().min(0).max(1),
  trackId: z.number().int().nonnegative().nullable().default(null),
  zoneId: z.string().uuid().nullable().default(null),
  bbox: bboxSchema.nullable().default(null),
  attributes: personAttributesSchema.nullable().default(null),
  /** Modelni kuzatib borish uchun: qaysi model versiyasi bu eventni chiqardi. */
  modelVersions: z.record(z.string(), z.string()).default({}),
  /**
   * Base64 JPEG. event-service uni MinIO ga yuklab, o'rniga URL qo'yadi.
   * Redis da uzoq qolmasligi uchun stream maxlen bilan cheklangan.
   */
  snapshotJpegBase64: z.string().nullable().default(null),
  /** Qo'shimcha, detektorga xos tafsilotlar (masalan fall uchun torso burchagi). */
  meta: z.record(z.string(), z.unknown()).default({}),
});

export type DetectionEvent = z.infer<typeof detectionEventSchema>;

/** Postgres dan qaytadigan, UI ko'radigan shakl. */
export interface StoredEvent {
  id: string;
  orgId: string;
  cameraId: string;
  cameraName: string;
  siteName: string | null;
  type: EventType;
  severity: EventSeverity;
  status: EventStatus;
  startedAt: string;
  confirmedAt: string;
  confidence: number;
  trackId: number | null;
  zoneId: string | null;
  zoneName: string | null;
  bbox: BBox | null;
  attributes: PersonAttributes | null;
  snapshotUrl: string | null;
  clipUrl: string | null;
  modelVersions: Record<string, string>;
  meta: Record<string, unknown>;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
}

export const EVENT_SEVERITY_ORDER: Record<EventSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export const DEFAULT_EVENT_SEVERITY: Record<EventType, EventSeverity> = {
  person_detected: "info",
  fire: "critical",
  smoke: "high",
  fall: "critical",
  smoking: "medium",
  zone_intrusion: "high",
  loitering: "low",
  camera_offline: "high",
  camera_online: "info",
};
