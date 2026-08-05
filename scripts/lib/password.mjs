// Parol xeshlash. apps/web/lib/auth/password.ts bilan bir xil format
// ishlatilishi shart, aks holda skript yaratgan foydalanuvchi kira olmaydi.

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);

const N = 16384;
const r = 8;
const p = 1;
const KEY_LENGTH = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N,
    r,
    p,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    "scrypt",
    N,
    r,
    p,
    salt.toString("base64"),
    Buffer.from(derived).toString("base64"),
  ].join("$");
}

export async function verifyPassword(password, stored) {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, blockSize, parallelization, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");

  const derived = await scryptAsync(password.normalize("NFKC"), salt, expected.length, {
    N: Number(n),
    r: Number(blockSize),
    p: Number(parallelization),
    maxmem: 64 * 1024 * 1024,
  });

  return timingSafeEqual(Buffer.from(derived), expected);
}
