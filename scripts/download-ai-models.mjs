#!/usr/bin/env node
/**
 * AI worker uchun ixtiyoriy modellarni yuklab oladi.
 * Mavjud fayllarni qayta yozmaydi (--force bilan majburiy).
 */
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelsDir = path.resolve(__dirname, "../services/ai-worker/models");

const ASSETS = [
  {
    name: "face.pt",
    url: "https://github.com/YapaLab/yolo-face/releases/download/1.0.0/yolov8n-face.pt",
  },
  {
    name: "genderage.onnx",
    url: "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip",
    zipEntry: "genderage.onnx",
  },
];

const force = process.argv.includes("--force");

async function download(url, dest) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} — HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(dest));
}

async function extractZipEntry(zipPath, entryName, dest) {
  const { execFileSync } = await import("node:child_process");
  const isWin = process.platform === "win32";
  if (isWin) {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${path.dirname(zipPath).replace(/'/g, "''")}' -Force`,
      ],
      { stdio: "inherit" },
    );
    const { copyFileSync, unlinkSync } = await import("node:fs");
    const extracted = path.join(path.dirname(zipPath), entryName);
    copyFileSync(extracted, dest);
    unlinkSync(zipPath);
    return;
  }
  execFileSync("unzip", ["-j", "-o", zipPath, entryName, "-d", path.dirname(dest)], {
    stdio: "inherit",
  });
  const { renameSync, unlinkSync } = await import("node:fs");
  renameSync(path.join(path.dirname(dest), entryName), dest);
  unlinkSync(zipPath);
}

async function main() {
  mkdirSync(modelsDir, { recursive: true });

  for (const asset of ASSETS) {
    const dest = path.join(modelsDir, asset.name);
    if (existsSync(dest) && !force) {
      console.log(`✓ ${asset.name} — allaqachon bor`);
      continue;
    }

    console.log(`↓ ${asset.name} yuklanmoqda...`);
    if (asset.zipEntry) {
      const zipPath = path.join(modelsDir, `_tmp_${asset.name}.zip`);
      await download(asset.url, zipPath);
      await extractZipEntry(zipPath, asset.zipEntry, dest);
    } else {
      await download(asset.url, dest);
    }
    console.log(`✓ ${asset.name} saqlandi`);
  }

  console.log("\nTayyor. AI worker ni qayta yuklang: docker compose restart ai-worker");
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
