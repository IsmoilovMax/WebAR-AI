import type { NextRequest } from "next/server";
import { EVENT_SEVERITIES, EVENT_STATUSES, EVENT_TYPES } from "@acs/types";
import { z } from "zod";
import { apiSession } from "@/lib/auth/guard";
import { listEvents } from "@/lib/data/events";

const querySchema = z.object({
  type: z.array(z.enum(EVENT_TYPES)).optional(),
  severity: z.array(z.enum(EVENT_SEVERITIES)).optional(),
  status: z.array(z.enum(EVENT_STATUSES)).optional(),
  camera: z.array(z.string().uuid()).optional(),
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export async function GET(request: NextRequest) {
  const auth = await apiSession("event:read");
  if ("response" in auth) return auth.response;

  const params = request.nextUrl.searchParams;
  const parsed = querySchema.safeParse({
    type: params.getAll("type").length ? params.getAll("type") : undefined,
    severity: params.getAll("severity").length ? params.getAll("severity") : undefined,
    status: params.getAll("status").length ? params.getAll("status") : undefined,
    camera: params.getAll("camera").length ? params.getAll("camera") : undefined,
    before: params.get("before") ?? undefined,
    limit: params.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return Response.json(
      { error: "So'rov parametrlari noto'g'ri", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const events = await listEvents(auth.session.orgId, {
    types: parsed.data.type,
    excludeTypes: parsed.data.type?.length
      ? undefined
      : ["camera_online", "camera_offline"],
    severities: parsed.data.severity,
    statuses: parsed.data.status,
    cameraIds: parsed.data.camera,
    before: parsed.data.before,
    limit: parsed.data.limit,
  });

  return Response.json({ events });
}
