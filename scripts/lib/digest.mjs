// Hikvision ISAPI HTTP Digest autentifikatsiyasi.
//
// Node ning fetch i digest ni qo'llab-quvvatlamaydi, shuning uchun qo'lda:
// birinchi so'rov 401 va WWW-Authenticate qaytaradi, undan nonce olinadi va
// so'rov Authorization sarlavhasi bilan takrorlanadi.
//
// Ba'zi Hikvision qurilmalari basic auth ni ham qabul qiladi, ammo sukut
// bo'yicha "digest/basic" rejimida bo'ladi va digest afzal ko'riladi.

import { createHash, randomBytes } from "node:crypto";

const md5 = (value) => createHash("md5").update(value).digest("hex");

function parseChallenge(header) {
  const scheme = header.trim().split(/\s+/, 1)[0];
  if (scheme.toLowerCase() !== "digest") return null;

  const params = {};
  const body = header.trim().slice(scheme.length);
  const pattern = /(\w+)=(?:"([^"]*)"|([^,]*))/g;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    params[match[1].toLowerCase()] = match[2] ?? match[3]?.trim() ?? "";
  }
  return params;
}

function buildAuthorization({ username, password, method, uri, challenge, nc, cnonce }) {
  const { realm, nonce, qop, opaque, algorithm } = challenge;

  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);

  const useQop = typeof qop === "string" && qop.split(",").map((v) => v.trim()).includes("auth");

  const response = useQop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];

  if (algorithm) parts.push(`algorithm=${algorithm}`);
  if (useQop) parts.push(`qop=auth`, `nc=${nc}`, `cnonce="${cnonce}"`);
  if (opaque) parts.push(`opaque="${opaque}"`);

  return `Digest ${parts.join(", ")}`;
}

/**
 * Digest (yoki kerak bo'lsa basic) autentifikatsiya bilan so'rov yuboradi.
 * Standart fetch Response qaytaradi.
 */
export async function digestFetch(url, { username, password, method = "GET", ...init } = {}) {
  const target = new URL(url);
  const uri = target.pathname + target.search;

  const first = await fetch(url, { ...init, method });
  if (first.status !== 401) return first;

  const header = first.headers.get("www-authenticate");
  if (!header) return first;

  // Javob tanasi o'qilmasa, ulanish osilib qolishi mumkin.
  await first.arrayBuffer().catch(() => undefined);

  if (header.toLowerCase().startsWith("basic")) {
    const basic = Buffer.from(`${username}:${password}`).toString("base64");
    return fetch(url, {
      ...init,
      method,
      headers: { ...(init.headers ?? {}), Authorization: `Basic ${basic}` },
    });
  }

  const challenge = parseChallenge(header);
  if (!challenge) return first;

  const authorization = buildAuthorization({
    username,
    password,
    method,
    uri,
    challenge,
    nc: "00000001",
    cnonce: randomBytes(8).toString("hex"),
  });

  return fetch(url, {
    ...init,
    method,
    headers: { ...(init.headers ?? {}), Authorization: authorization },
  });
}
