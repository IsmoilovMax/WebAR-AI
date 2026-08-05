import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// scrypt tanlandi, chunki u Node ga kiritilgan (tashqi bog'liqlik yo'q) va
// xotira-og'ir - GPU bilan brute force ni qimmatlashtiradi.
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;

function deriveKey(
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await deriveKey(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N,
    r: R,
    p: P,
    maxmem: MAX_MEMORY,
  });

  return ["scrypt", N, R, P, salt.toString("base64"), derived.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, "base64");

  const derived = await deriveKey(
    password.normalize("NFKC"),
    Buffer.from(saltB64, "base64"),
    expected.length,
    { N: Number(n), r: Number(r), p: Number(p), maxmem: MAX_MEMORY },
  );

  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
