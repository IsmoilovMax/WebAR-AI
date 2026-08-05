import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Role, SessionUser } from "@acs/types";
import { query, queryOne } from "../db";

export const SESSION_COOKIE = "acs_session";
const SESSION_TTL_DAYS = 7;

/**
 * Bazada xom token emas, uning SHA-256 xeshi saqlanadi. Baza sizib chiqsa,
 * mavjud sessiyalarni o'g'irlab bo'lmaydi.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, orgId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000);

  await query(
    `INSERT INTO sessions (user_id, org_id, token_hash, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [userId, orgId, hashToken(token), expiresAt],
  );

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });

  return token;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (token) {
    await query("DELETE FROM sessions WHERE token_hash = $1", [hashToken(token)]);
  }

  store.delete(SESSION_COOKIE);
}

interface SessionRow {
  user_id: string;
  email: string;
  name: string;
  org_id: string;
  org_name: string;
  role: Role;
}

/**
 * `cache` bir so'rov ichida takroriy bazaga murojaatni oldini oladi:
 * layout, page va bir nechta komponent bir xil sessiyani so'raydi.
 */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = await queryOne<SessionRow>(
    `SELECT
       u.id::text   AS user_id,
       u.email,
       u.name,
       o.id::text   AS org_id,
       o.name       AS org_name,
       m.role
     FROM sessions s
     JOIN users u         ON u.id = s.user_id
     JOIN organizations o ON o.id = s.org_id
     JOIN memberships m   ON m.user_id = u.id AND m.org_id = s.org_id
     WHERE s.token_hash = $1
       AND s.expires_at > now()
       AND u.is_active`,
    [hashToken(token)],
  );

  if (!row) return null;

  return {
    id: row.user_id,
    email: row.email,
    name: row.name,
    orgId: row.org_id,
    orgName: row.org_name,
    role: row.role,
  };
});

export async function purgeExpiredSessions(): Promise<number> {
  const rows = await query<{ count: string }>(
    "WITH deleted AS (DELETE FROM sessions WHERE expires_at < now() RETURNING 1) " +
      "SELECT count(*)::text AS count FROM deleted",
  );
  return Number(rows[0]?.count ?? 0);
}
