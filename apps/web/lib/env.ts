import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { z } from "zod";

/**
 * Muhit o'zgaruvchilari ilova ishga tushganda bir marta tekshiriladi.
 * Yetishmayotgan sozlamani ish vaqtida topgandan ko'ra, startda topish
 * ancha arzon.
 *
 * Monorepo: .env odatda ildizda. Next.js faqat apps/web ni o'qiydi —
 * shuning uchun ildizni ham qidiramiz.
 */
function ensureEnvLoaded() {
  let dir = process.cwd();
  for (let i = 0; i < 4; i += 1) {
    if (existsSync(path.join(dir, ".env"))) {
      loadEnvConfig(dir);
      break;
    }
    dir = path.resolve(dir, "..");
  }
  loadEnvConfig(process.cwd());
}

const serverSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL kerak"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET kamida 32 belgi bo'lishi kerak"),
  CREDENTIALS_ENCRYPTION_KEY: z
    .string()
    .min(1, "CREDENTIALS_ENCRYPTION_KEY kerak (base64, 32 bayt)"),
  GO2RTC_URL: z.string().url().default("http://localhost:1984"),
  AI_WORKER_URL: z.string().url().default("http://localhost:8000"),
  AI_WORKER_TOKEN: z.string().default(""),
  /**
   * Tashqi React/Node sayt BFF uchun. Bo'sh bo'lsa faqat cookie sessiya
   * ishlaydi. Yaratish: openssl rand -hex 32
   */
  ACS_SERVICE_TOKEN: z.string().default(""),
  REDIS_URL: z.string().default("redis://localhost:6379/0"),
  S3_PUBLIC_ENDPOINT: z.string().url().default("http://localhost:9000"),
  S3_BUCKET: z.string().default("acs-media"),
  MEDIA_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
});

type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;

  ensureEnvLoaded();

  // Next.js/Turbopack process.env ni "butun obyekt" qilib bermaydi —
  // faqat aniq process.env.NAME murojaatlari ko'rinadi.
  const parsed = serverSchema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    CREDENTIALS_ENCRYPTION_KEY: process.env.CREDENTIALS_ENCRYPTION_KEY,
    GO2RTC_URL: process.env.GO2RTC_URL,
    AI_WORKER_URL: process.env.AI_WORKER_URL,
    AI_WORKER_TOKEN: process.env.AI_WORKER_TOKEN,
    ACS_SERVICE_TOKEN: process.env.ACS_SERVICE_TOKEN,
    REDIS_URL: process.env.REDIS_URL,
    S3_PUBLIC_ENDPOINT: process.env.S3_PUBLIC_ENDPOINT,
    S3_BUCKET: process.env.S3_BUCKET,
    MEDIA_RETENTION_DAYS: process.env.MEDIA_RETENTION_DAYS,
  });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Muhit sozlamalari noto'g'ri:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}
