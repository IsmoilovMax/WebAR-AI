import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { serverEnv } from "./env";

/**
 * Kamera parollarini shifrlash.
 *
 * Format: v1:<nonce_b64>:<ciphertext+tag_b64>
 * services/ai-worker/app/crypto.py bilan bir xil bo'lishi shart.
 *
 * Kalit bazada emas, muhit o'zgaruvchisida. Baza dampi sizib chiqsa ham,
 * kameralarga kirish ochilmaydi - bu CCTV tizimida eng jiddiy risk.
 */

const PREFIX = "v1";
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function key(): Buffer {
  const raw = Buffer.from(serverEnv().CREDENTIALS_ENCRYPTION_KEY, "base64");
  if (raw.length !== 32) {
    throw new Error(
      `CREDENTIALS_ENCRYPTION_KEY 32 bayt bo'lishi kerak, ${raw.length} berilgan. ` +
        `Yaratish: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return raw;
}

export function encryptSecret(plaintext: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  return `${PREFIX}:${nonce.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    throw new Error("Shifrlangan qiymat formati noto'g'ri");
  }

  const nonce = Buffer.from(parts[1], "base64");
  const combined = Buffer.from(parts[2], "base64");
  const tag = combined.subarray(combined.length - TAG_BYTES);
  const ciphertext = combined.subarray(0, combined.length - TAG_BYTES);

  const decipher = createDecipheriv("aes-256-gcm", key(), nonce);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
