import "server-only";

import { createClient, type RedisClientType } from "redis";
import { serverEnv } from "./env";

let client: RedisClientType | null = null;

/** Shared Redis (overlay pub/sub + latest key). */
export async function getRedis(): Promise<RedisClientType> {
  if (client?.isOpen) return client;

  client = createClient({ url: serverEnv().REDIS_URL });
  client.on("error", (error) => {
    console.error("Redis xatosi:", error);
  });
  await client.connect();
  return client;
}

export function overlayChannel(cameraId: string): string {
  return `acs:overlay:${cameraId}`;
}

export function overlayLatestKey(cameraId: string): string {
  return `${overlayChannel(cameraId)}:latest`;
}
