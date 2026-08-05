import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { serverEnv } from "./env";

/**
 * Next.js dev rejimida modullar qayta yuklanadi. Pool ni global ga
 * bog'lamasak, har bir hot reload yangi ulanishlar hovuzini yaratadi va
 * Postgres "too many connections" bilan yiqiladi.
 */
const globalForDb = globalThis as unknown as { acsPool?: Pool };

function createPool(): Pool {
  const pool = new Pool({
    connectionString: serverEnv().DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  // Bo'sh ulanishdagi xato jarayonni yiqitmasligi kerak.
  pool.on("error", (error) => {
    console.error("Postgres pool xatosi:", error);
  });

  return pool;
}

export function db(): Pool {
  if (!globalForDb.acsPool) {
    globalForDb.acsPool = createPool();
  }
  return globalForDb.acsPool;
}

export async function query<T extends QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await db().query<T>(text, params as unknown[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function transaction<T>(
  handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db().connect();
  try {
    await client.query("BEGIN");
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
