import type { NextRequest } from "next/server";
import { EVENT_STATUSES } from "@acs/types";
import { z } from "zod";
import { apiSession } from "@/lib/auth/guard";
import { recordAudit } from "@/lib/audit";
import { getEvent, updateEventStatus } from "@/lib/data/events";
import { queueFeedback } from "@/lib/data/feedback";

const patchSchema = z.object({
  status: z.enum(EVENT_STATUSES),
});

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  const auth = await apiSession("event:read");
  if ("response" in auth) return auth.response;

  const { eventId } = await context.params;
  const event = await getEvent(auth.session.orgId, eventId);

  if (!event) return Response.json({ error: "Hodisa topilmadi" }, { status: 404 });
  return Response.json({ event });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ eventId: string }> },
) {
  const auth = await apiSession("event:acknowledge");
  if ("response" in auth) return auth.response;

  const { eventId } = await context.params;
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return Response.json({ error: "Holat qiymati noto'g'ri" }, { status: 400 });
  }

  const event = await updateEventStatus(
    auth.session.orgId,
    eventId,
    parsed.data.status,
    auth.session.id,
  );

  if (!event) return Response.json({ error: "Hodisa topilmadi" }, { status: 404 });

  // Operator baholagan har bir hodisa - o'quv namunasi. Yolg'on signal
  // ayniqsa qimmatli: aynan shu yerda model xato qilgan.
  if (parsed.data.status === "false_positive" || parsed.data.status === "resolved") {
    await queueFeedback({
      orgId: auth.session.orgId,
      eventId: event.id,
      eventType: event.type,
      label: parsed.data.status === "false_positive" ? "false_positive" : "true_positive",
      userId: auth.session.id,
    });
  }

  await recordAudit(auth.session, "event.status", "event", eventId, {
    status: parsed.data.status,
    type: event.type,
  });

  return Response.json({ event });
}
