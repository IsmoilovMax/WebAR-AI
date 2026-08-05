import "server-only";

import { headers } from "next/headers";
import type { SessionUser } from "@acs/types";
import { query } from "./db";

/**
 * Audit yozuvi.
 *
 * Biometrik ma'lumot bilan ishlaydigan tizimda "kim qaysi videoni ko'rdi"
 * savoliga javob bera olish huquqiy talab. Shuning uchun video ko'rish ham
 * yoziladi, faqat sozlama o'zgarishlari emas.
 */
export async function recordAudit(
  session: SessionUser,
  action: string,
  resource: string,
  resourceId?: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    const headerList = await headers();
    const forwarded = headerList.get("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim() || null;

    await query(
      `INSERT INTO audit_log (org_id, user_id, action, resource, resource_id, ip_address, user_agent, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        session.orgId,
        session.id,
        action,
        resource,
        resourceId ?? null,
        ip,
        headerList.get("user-agent"),
        JSON.stringify(detail),
      ],
    );
  } catch (error) {
    // Audit yozuvidagi xato asosiy amalni to'xtatmasligi kerak, ammo
    // e'tibordan chetda ham qolmasligi kerak.
    console.error("Audit yozuvi muvaffaqiyatsiz:", error);
  }
}
