import { z } from "zod";
import { bboxSchema } from "./events";

/** Live video ustidagi ramka (normallashtirilgan 0..1). */
export const overlayBoxSchema = z.object({
  label: z.string(),
  /** person / fire / smoke / cigarette / face / other */
  kind: z.enum(["person", "fire", "smoke", "cigarette", "face", "other"]),
  confidence: z.number().min(0).max(1),
  bbox: bboxSchema,
  trackId: z.number().int().nonnegative().nullable().default(null),
  /** Demografiya: "Erkak · o'rta" kabi qo'shimcha matn */
  subtitle: z.string().nullable().optional(),
});

export type OverlayBox = z.infer<typeof overlayBoxSchema>;

export const liveOverlaySchema = z.object({
  cameraId: z.string().uuid(),
  /** Unix epoch seconds (float). */
  ts: z.number(),
  boxes: z.array(overlayBoxSchema),
});

export type LiveOverlay = z.infer<typeof liveOverlaySchema>;

export const OVERLAY_KIND_COLORS: Record<OverlayBox["kind"], string> = {
  person: "#22c55e",
  fire: "#ef4444",
  smoke: "#f97316",
  cigarette: "#eab308",
  face: "#38bdf8",
  other: "#a3a3a3",
};
