import "server-only";

import { createHash, randomBytes } from "node:crypto";

/**
 * Hikvision ISAPI klienti.
 *
 * Faqat kamera qo'shishda ishlatiladi: qurilma haqiqatan javob beradimi,
 * qanday kanallari bor, sub-stream AI uchun mosmi. Uzluksiz video bu yerdan
 * o'tmaydi - u go2rtc va AI worker orqali ketadi.
 */

const md5 = (value: string) => createHash("md5").update(value).digest("hex");

interface DigestChallenge {
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
}

function parseChallenge(header: string): DigestChallenge | null {
  if (!header.trim().toLowerCase().startsWith("digest")) return null;

  const params: Record<string, string> = {};
  const pattern = /(\w+)=(?:"([^"]*)"|([^,]*))/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(header)) !== null) {
    params[match[1].toLowerCase()] = (match[2] ?? match[3] ?? "").trim();
  }

  if (!params.realm || !params.nonce) return null;
  return params as unknown as DigestChallenge;
}

function buildAuthorization(
  username: string,
  password: string,
  method: string,
  uri: string,
  challenge: DigestChallenge,
): string {
  const nc = "00000001";
  const cnonce = randomBytes(8).toString("hex");

  const ha1 = md5(`${username}:${challenge.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);

  const useQop = challenge.qop
    ?.split(",")
    .map((value) => value.trim())
    .includes("auth");

  const response = useQop
    ? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:auth:${ha2}`)
    : md5(`${ha1}:${challenge.nonce}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];

  if (challenge.algorithm) parts.push(`algorithm=${challenge.algorithm}`);
  if (useQop) parts.push("qop=auth", `nc=${nc}`, `cnonce="${cnonce}"`);
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);

  return `Digest ${parts.join(", ")}`;
}

interface IsapiOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  timeoutMs?: number;
}

/** Digest auth bilan ISAPI so'rovi. Hikvision sukut bo'yicha digest kutadi. */
async function isapiGet(options: IsapiOptions, path: string): Promise<string> {
  const url = `http://${options.host}:${options.port}${path}`;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 5000);

  const first = await fetch(url, { signal, cache: "no-store" });

  if (first.status !== 401) {
    if (!first.ok) throw new Error(`ISAPI ${path}: HTTP ${first.status}`);
    return first.text();
  }

  const header = first.headers.get("www-authenticate") ?? "";
  await first.text().catch(() => undefined);

  const authorization = header.toLowerCase().startsWith("basic")
    ? `Basic ${Buffer.from(`${options.username}:${options.password}`).toString("base64")}`
    : (() => {
        const challenge = parseChallenge(header);
        if (!challenge) throw new Error("Kamera autentifikatsiya usulini tushunib bo'lmadi");
        return buildAuthorization(options.username, options.password, "GET", path, challenge);
      })();

  const second = await fetch(url, {
    headers: { Authorization: authorization },
    signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
    cache: "no-store",
  });

  if (second.status === 401) throw new Error("Login yoki parol noto'g'ri");
  if (!second.ok) throw new Error(`ISAPI ${path}: HTTP ${second.status}`);

  return second.text();
}

function tagValue(xml: string, name: string): string | null {
  return new RegExp(`<${name}>([^<]*)</${name}>`, "i").exec(xml)?.[1]?.trim() ?? null;
}

export interface StreamChannel {
  id: string;
  kind: "main" | "sub" | "third";
  width: number;
  height: number;
  fps: number;
  codec: string;
}

export interface ProbeResult {
  ok: boolean;
  model: string | null;
  deviceName: string | null;
  firmware: string | null;
  serialNumber: string | null;
  channels: StreamChannel[];
  warnings: string[];
}

/**
 * Kamerani tekshiradi va AI uchun mosligini baholaydi.
 *
 * Ogohlantirishlar juda muhim: amaliyotda "tizim ishlamayapti" shikoyatlarining
 * katta qismi 1080p sub-stream yoki H.265 kodek sababli bo'ladi.
 */
export async function probeCamera(options: IsapiOptions): Promise<ProbeResult> {
  const warnings: string[] = [];

  const deviceXml = await isapiGet(options, "/ISAPI/System/deviceInfo");
  const channelsXml = await isapiGet(options, "/ISAPI/Streaming/channels");

  const channels: StreamChannel[] = [];
  const blocks = channelsXml.matchAll(
    /<StreamingChannel[^>]*>([\s\S]*?)<\/StreamingChannel>/gi,
  );

  for (const [, block] of blocks) {
    const id = tagValue(block, "id") ?? "";
    const width = Number(tagValue(block, "videoResolutionWidth") ?? 0);
    const height = Number(tagValue(block, "videoResolutionHeight") ?? 0);
    const codec = tagValue(block, "videoCodecType") ?? "unknown";
    const fps = Number(tagValue(block, "maxFrameRate") ?? 0) / 100;

    const kind = id.endsWith("1") ? "main" : id.endsWith("2") ? "sub" : "third";
    channels.push({ id, kind, width, height, fps, codec });

    if (kind !== "sub") continue;

    if (width > 1280 || height > 720) {
      warnings.push(
        `Sub-stream juda katta (${width}x${height}). AI uchun 640x480 yetarli; ` +
          "kattaroq oqim GPU ni behuda sarflaydi.",
      );
    } else if (width > 0 && width < 480) {
      warnings.push(
        `Sub-stream juda kichik (${width}x${height}). Yuz va sigaret aniqlanmaydi.`,
      );
    }

    if (codec.toUpperCase().includes("265")) {
      warnings.push(
        "Sub-stream H.265 kodekda. Brauzerlar uni WebRTC da ijro eta olmaydi, " +
          "go2rtc transkodlashi kerak bo'ladi. Iloji bo'lsa H.264 ga o'tkazing.",
      );
    }
  }

  if (channels.length === 0) {
    warnings.push("Oqim kanallari topilmadi. Qurilma NVR bo'lishi mumkin.");
  }

  return {
    ok: true,
    model: tagValue(deviceXml, "model"),
    deviceName: tagValue(deviceXml, "deviceName"),
    firmware: tagValue(deviceXml, "firmwareVersion"),
    serialNumber: tagValue(deviceXml, "serialNumber"),
    channels,
    warnings,
  };
}
