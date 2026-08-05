import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Monorepo: .env ildizda yotadi; Next.js default bo'yicha faqat apps/web ni
// qidiradi. Ildizni birinchi yuklaymiz, keyin apps/web override bo'lishi mumkin.
const appDir = import.meta.dirname;
const repoRoot = path.join(appDir, "../..");
loadEnvConfig(repoRoot);
loadEnvConfig(appDir);

const nextConfig: NextConfig = {
  // Monorepo: Next.js standalone chiqishini to'g'ri yig'ishi uchun ildizni
  // aniq ko'rsatamiz, aks holda u apps/web ni ildiz deb o'ylaydi va
  // packages/types ni chiqarib tashlaydi.
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),

  // Ishchi paket TypeScript manbasi sifatida ulanadi (build qadami yo'q).
  transpilePackages: ["@acs/types"],

  // Docker ga joylash uchun: node_modules ni to'liq nusxalash shart emas.
  output: "standalone",

  serverExternalPackages: ["pg", "redis"],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Kamera va mikrofon faqat brauzer-demo sahifasida kerak,
          // dashboardda umuman kerak emas.
          { key: "Permissions-Policy", value: "camera=(self), microphone=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
