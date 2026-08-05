import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { hasPermission, type Permission, type SessionUser } from "@acs/types";
import { serverEnv } from "../env";
import { getSession } from "./session";

export class ForbiddenError extends Error {
  constructor(permission: Permission) {
    super(`Ruxsat yetarli emas: ${permission}`);
    this.name = "ForbiddenError";
  }
}

/**
 * Sahifalar uchun: sessiya bo'lmasa login ga yo'naltiradi.
 *
 * Muhim: bu tekshiruv proxy da emas, ma'lumotga eng yaqin joyda
 * bajariladi. Proxy faqat optimistik filtr - u bazaga murojaat qilmaydi
 * va uni yagona himoya deb hisoblash mumkin emas.
 */
export async function requireSession(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const session = await requireSession();
  if (!hasPermission(session.role, permission)) {
    throw new ForbiddenError(permission);
  }
  return session;
}

/** Route Handler lar uchun: redirect emas, 401/403 javob qaytaradi. */
export async function apiSession(
  permission?: Permission,
): Promise<{ session: SessionUser } | { response: Response }> {
  const session = await getSession();

  if (!session) {
    return {
      response: Response.json({ error: "Avtorizatsiya talab qilinadi" }, { status: 401 }),
    };
  }

  if (permission && !hasPermission(session.role, permission)) {
    return {
      response: Response.json({ error: "Ruxsat yetarli emas" }, { status: 403 }),
    };
  }

  return { session };
}

/**
 * Cookie sessiya YOKI tashqi sayt BFF uchun Bearer ACS_SERVICE_TOKEN.
 *
 * Service token faqat server-to-server (sizning Node.js) da ishlatiladi —
 * brauzerga berilmasin.
 */
export async function apiSessionOrServiceToken(
  request: Request,
  permission?: Permission,
): Promise<
  | { kind: "session"; session: SessionUser }
  | { kind: "service" }
  | { response: Response }
> {
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const expected = serverEnv().ACS_SERVICE_TOKEN;

  if (token && expected && safe.equal(token, expected)) {
    return { kind: "service" };
  }

  const auth = await apiSession(permission);
  if ("response" in auth) return auth;
  return { kind: "session", session: auth.session };
}

const safe = {
  equal(a: string, b: string): boolean {
    const ha = createHash("sha256").update(a).digest();
    const hb = createHash("sha256").update(b).digest();
    return timingSafeEqual(ha, hb);
  },
};
