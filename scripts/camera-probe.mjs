#!/usr/bin/env node
// Hikvision kamerani tekshiradi: ISAPI javob beradimi, qanday kanallar bor,
// sub-stream rezolyutsiyasi va kodeki AI uchun mosmi.
//
//   node scripts/camera-probe.mjs --host 192.168.1.64 --user admin --password secret
//
// Kamera qo'shishdan oldin shu skriptni yugurtiring: aksariyat "ishlamayapti"
// muammolari noto'g'ri port, H.265 kodek yoki 1080p sub-stream sababli bo'ladi.

import process from "node:process";
import { digestFetch } from "./lib/digest.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

/** ISAPI XML qaytaradi. To'liq parser shart emas - kerakli teglarni olamiz. */
function tag(xml, name) {
  const match = new RegExp(`<${name}>([^<]*)</${name}>`, "i").exec(xml);
  return match?.[1]?.trim() ?? null;
}

function allBlocks(xml, name) {
  return [...xml.matchAll(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "gi"))].map(
    (m) => m[1],
  );
}

async function get(base, path, auth) {
  const response = await digestFetch(`${base}${path}`, auth);
  if (!response.ok) {
    throw new Error(`${path} -> HTTP ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const host = args.host;
  const username = args.user ?? args.username;
  const password = args.password ?? process.env.CAMERA_PASSWORD;
  const port = Number(args.port ?? 80);

  if (!host || !username || !password) {
    console.error("Ishlatish: --host <ip> --user <login> --password <parol> [--port 80]");
    process.exit(1);
  }

  const base = `http://${host}:${port}`;
  const auth = { username, password };

  console.log(`\nTekshirilmoqda: ${base}\n`);

  const deviceXml = await get(base, "/ISAPI/System/deviceInfo", auth);
  console.log("Qurilma");
  console.log(`  Model:     ${tag(deviceXml, "model") ?? "-"}`);
  console.log(`  Nomi:      ${tag(deviceXml, "deviceName") ?? "-"}`);
  console.log(`  Firmware:  ${tag(deviceXml, "firmwareVersion") ?? "-"}`);
  console.log(`  Seriya:    ${tag(deviceXml, "serialNumber") ?? "-"}`);

  const channelsXml = await get(base, "/ISAPI/Streaming/channels", auth);
  const channels = allBlocks(channelsXml, "StreamingChannel");

  console.log(`\nOqim kanallari (${channels.length})`);

  let subStreamOk = false;

  for (const channel of channels) {
    const id = tag(channel, "id");
    const codec = tag(channel, "videoCodecType");
    const width = Number(tag(channel, "videoResolutionWidth") ?? 0);
    const height = Number(tag(channel, "videoResolutionHeight") ?? 0);
    const fps = Number(tag(channel, "maxFrameRate") ?? 0) / 100;
    const bitrate = tag(channel, "vbrUpperCap") ?? tag(channel, "constantBitRate") ?? "-";

    const kind = id?.endsWith("1") ? "main" : id?.endsWith("2") ? "sub" : "third";
    console.log(
      `  [${id}] ${kind.padEnd(5)} ${width}x${height} ${String(fps).padStart(4)}fps ` +
        `${codec} ${bitrate}kbps`,
    );

    if (kind !== "sub") continue;

    // AI sub-stream ni oladi. 640x480 atrofida bo'lishi kerak: kattaroq
    // rezolyutsiya GPU ni behuda yeydi, kichigi esa yuz va sigaretni yo'qotadi.
    if (width > 1280 || height > 720) {
      console.log(
        `        Ogohlantirish: sub-stream juda katta (${width}x${height}). ` +
          "Kamera sozlamalaridan 640x480 ga tushiring - GPU tejaladi.",
      );
    } else if (width < 480) {
      console.log(
        `        Ogohlantirish: sub-stream juda kichik (${width}x${height}). ` +
          "Yuz va sigaret aniqlanmaydi. 640x480 tavsiya etiladi.",
      );
    } else {
      subStreamOk = true;
    }

    if (codec && codec.toUpperCase().includes("265")) {
      console.log(
        "        Ogohlantirish: H.265. Aksariyat brauzerlar uni WebRTC da " +
          "ijro eta olmaydi, go2rtc transkodlashi kerak bo'ladi (CPU sarfi). " +
          "Iloji bo'lsa kamerani H.264 ga o'tkazing.",
      );
    }
  }

  // Kamera o'zining AI hodisalarini ham beradi. Biz o'z modellarimizni
  // ishlatamiz, ammo qurilma imkoniyatini bilish foydali.
  try {
    const capXml = await get(base, "/ISAPI/Event/triggers", auth);
    const triggers = [...capXml.matchAll(/<eventType>([^<]+)<\/eventType>/gi)].map((m) => m[1]);
    if (triggers.length > 0) {
      console.log(`\nQurilma hodisalari: ${[...new Set(triggers)].join(", ")}`);
    }
  } catch {
    console.log("\nQurilma hodisalari: mavjud emas (muhim emas)");
  }

  const channelId = Number(args.channel ?? 1) * 100 + 2;
  console.log("\nAI uchun RTSP URL:");
  console.log(`  rtsp://${username}:***@${host}:554/Streaming/Channels/${channelId}`);
  console.log(`\nNatija: ${subStreamOk ? "kamera tayyor" : "sozlash kerak (yuqoriga qarang)"}\n`);
}

main().catch((error) => {
  console.error(`\nXato: ${error.message}\n`);
  console.error(
    "Tez-tez uchraydigan sabablar: noto'g'ri port (HTTPS uchun 443), " +
      "ISAPI o'chirilgan, yoki kamera boshqa tarmoqda.",
  );
  process.exit(1);
});
