import type { Metadata } from "next";
import type { EventStatus } from "@acs/types";
import { EVENT_STATUSES } from "@acs/types";
import { EventFeed } from "@/components/events/EventFeed";
import { Stat } from "@/components/ui/primitives";
import { requirePermission } from "@/lib/auth/guard";
import { listCameras } from "@/lib/data/cameras";
import { eventCounts, listEvents } from "@/lib/data/events";
import { formatPercent } from "@/lib/utils";

export const metadata: Metadata = { title: "Hodisalar" };

function parseStatus(value: string | undefined): EventStatus | "all" {
  if (!value) return "new";
  return (EVENT_STATUSES as readonly string[]).includes(value)
    ? (value as EventStatus)
    : "all";
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await requirePermission("event:read");
  const { status } = await searchParams;
  const initialStatus = parseStatus(status);

  const [events, cameras, counts] = await Promise.all([
    listEvents(session.orgId, {
      statuses: initialStatus === "all" ? undefined : [initialStatus],
      limit: 50,
    }),
    listCameras(session.orgId),
    eventCounts(session.orgId),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <h1 className="text-lg font-semibold">Hodisalar</h1>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="24 soatda" value={counts.total} />
        <Stat
          label="Ko'rilmagan"
          value={counts.unresolved}
          tone={counts.unresolved > 0 ? "warning" : "neutral"}
        />
        <Stat
          label="Kritik (24 soat)"
          value={counts.critical24h}
          tone={counts.critical24h > 0 ? "danger" : "neutral"}
        />
        <Stat
          label="Yolg'on signal"
          value={formatPercent(counts.falsePositiveRate)}
          hint="Oxirgi 7 kun, baholangan hodisalardan"
          // 10% dan oshsa operatorlar signallarga ishonmay qo'yadi.
          tone={counts.falsePositiveRate > 0.1 ? "danger" : "success"}
        />
      </div>

      <EventFeed initialEvents={events} cameras={cameras} initialStatus={initialStatus} />
    </div>
  );
}
