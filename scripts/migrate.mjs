#!/usr/bin/env node
// Oddiy oldinga yo'naltirilgan migrator. Har bir fayl bir marta, tranzaksiya
// ichida bajariladi va schema_migrations jadvaliga yoziladi.
//
// Ishlatish:
//   node scripts/migrate.mjs            - barcha kutilayotgan migratsiyalar
//   SKIP_SEED=1 node scripts/migrate.mjs - seed fayllarini o'tkazib yuborish

import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, "..", "infra", "db", "migrations");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL o'rnatilmagan. .env faylini tekshiring.");
  process.exit(1);
}

const skipSeed = process.env.SKIP_SEED === "1";

async function main() {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const { rows: applied } = await client.query(
    "SELECT name, checksum FROM schema_migrations",
  );
  const appliedByName = new Map(applied.map((row) => [row.name, row.checksum]));

  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .filter((file) => !(skipSeed && file.includes("seed")))
    .sort();

  let ran = 0;

  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const previous = appliedByName.get(file);

    if (previous === checksum) continue;

    // Qo'llanilgan migratsiya keyin o'zgartirilgan bo'lsa, jimgina o'tkazib
    // yuborish xavfli - baza va kod bir-biriga mos kelmay qoladi.
    if (previous && previous !== checksum) {
      throw new Error(
        `Migratsiya "${file}" qo'llanilgandan keyin o'zgartirilgan. ` +
          "Uni qaytaring yoki yangi migratsiya fayli qo'shing.",
      );
    }

    process.stdout.write(`-> ${file} `);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)",
        [file, checksum],
      );
      await client.query("COMMIT");
      console.log("ok");
      ran += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      console.log("xato");
      throw error;
    }
  }

  await client.end();
  console.log(ran === 0 ? "Yangi migratsiya yo'q." : `${ran} ta migratsiya qo'llandi.`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
