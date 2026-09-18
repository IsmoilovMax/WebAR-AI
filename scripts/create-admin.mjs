#!/usr/bin/env node
// Tashkilot va uning birinchi egasini yaratadi.
//
//   node scripts/create-admin.mjs --email admin@demo.local --org demo
//
// Parol interaktiv so'raladi (yoki ADMIN_PASSWORD env orqali beriladi),
// shunda u shell tarixiga tushmaydi.

import { createInterface } from "node:readline/promises";
import { randomUUID } from "node:crypto";
import process from "node:process";
import pg from "pg";
import { hashPassword } from "./lib/password.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const value = argv[i + 1]?.startsWith("--") ? "true" : argv[i + 1];
    args[key] = value ?? "true";
  }
  return args;
}

async function promptPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const password = await rl.question("Parol (kamida 12 belgi): ");
  rl.close();
  return password;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.email;
  const orgSlug = (args.org ?? "demo").trim().toLowerCase();
  const orgName = args["org-name"] ?? "Demo tashkilot";
  const name = args.name ?? "Administrator";

  if (!email) {
    console.error("--email majburiy");
    process.exit(1);
  }

  const password = args.password || (await promptPassword());
  if (!password || password.length < 4) {
    console.error("Parol kamida 4 belgidan iborat bo'lishi kerak.");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query("BEGIN");

    const org = await client.query(
      `INSERT INTO organizations (id, name, slug)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [randomUUID(), orgName, orgSlug],
    );
    const orgId = org.rows[0].id;

    const passwordHash = await hashPassword(password);
    const normalizedEmail = email.trim().toLowerCase();

    // Unique indeks: lower(email) — ON CONFLICT (email) ishlamaydi.
    const user = await client.query(
      `INSERT INTO users (id, email, name, password_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ((lower(email))) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             name = EXCLUDED.name
       RETURNING id`,
      [randomUUID(), normalizedEmail, name, passwordHash],
    );
    const userId = user.rows[0].id;

    await client.query(
      `INSERT INTO memberships (user_id, org_id, role)
       VALUES ($1, $2, 'owner')
       ON CONFLICT (user_id, org_id) DO UPDATE SET role = 'owner'`,
      [userId, orgId],
    );

    await client.query("COMMIT");
    console.log(`Tayyor. ${email} -> "${orgSlug}" tashkilotining egasi.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
