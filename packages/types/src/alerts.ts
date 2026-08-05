import { z } from "zod";
import { EVENT_SEVERITIES, EVENT_TYPES } from "./events";

export const ALERT_CHANNELS = ["telegram", "webhook", "email"] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export const telegramTargetSchema = z.object({
  kind: z.literal("telegram"),
  chatId: z.string().min(1),
});

export const webhookTargetSchema = z.object({
  kind: z.literal("webhook"),
  url: z.string().url(),
  secret: z.string().optional(),
});

export const emailTargetSchema = z.object({
  kind: z.literal("email"),
  to: z.array(z.string().email()).min(1),
});

export const alertTargetSchema = z.discriminatedUnion("kind", [
  telegramTargetSchema,
  webhookTargetSchema,
  emailTargetSchema,
]);

export type AlertTarget = z.infer<typeof alertTargetSchema>;

/** HH:MM formatida, kamera lokal vaqt zonasida. */
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const alertRuleInputSchema = z.object({
  name: z.string().min(1).max(120),
  eventTypes: z.array(z.enum(EVENT_TYPES)).min(1),
  minSeverity: z.enum(EVENT_SEVERITIES).default("medium"),
  /** Bo'sh = barcha kameralar. */
  cameraIds: z.array(z.string().uuid()).default([]),
  target: alertTargetSchema,
  /** Faqat shu oraliqda yuborish. Null = 24/7. */
  activeFrom: timeOfDay.nullable().default(null),
  activeTo: timeOfDay.nullable().default(null),
  /**
   * Bir xil kamera + event turi bo'yicha spamni to'xtatadi.
   * Yong'in uchun kichik, chekish uchun katta qiymat mantiqiy.
   */
  cooldownSeconds: z.number().int().min(0).max(86400).default(300),
  enabled: z.boolean().default(true),
});

export type AlertRuleInput = z.infer<typeof alertRuleInputSchema>;

export interface AlertRule extends AlertRuleInput {
  id: string;
  orgId: string;
  createdAt: string;
}
