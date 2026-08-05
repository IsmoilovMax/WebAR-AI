import type { Metadata } from "next";
import Link from "next/link";
import { AnalyticsDashboard } from "@/components/analytics/AnalyticsDashboard";
import { requirePermission } from "@/lib/auth/guard";
import {
  demographicsBreakdown,
  detectorQuality,
  eventTimeseries,
  eventsByCamera,
  footfallByHour,
} from "@/lib/data/analytics";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Analitika" };

const RANGES = [7, 30, 90] as const;

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const session = await requirePermission("analytics:read");
  const { days: daysRaw } = await searchParams;
  const days = RANGES.includes(Number(daysRaw) as (typeof RANGES)[number])
    ? Number(daysRaw)
    : 7;

  const [timeseries, quality, demographics, footfall, byCamera] = await Promise.all([
    eventTimeseries(session.orgId, days),
    detectorQuality(session.orgId, days),
    demographicsBreakdown(session.orgId, days),
    footfallByHour(session.orgId, days),
    eventsByCamera(session.orgId, days),
  ]);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">Analitika</h1>
        <div className="flex gap-1 rounded-lg bg-surface-1 p-1 ring-1 ring-surface-2">
          {RANGES.map((range) => (
            <Link
              key={range}
              href={`/analytics?days=${range}`}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium",
                days === range
                  ? "bg-brand/15 text-brand"
                  : "text-content-secondary hover:text-content-primary",
              )}
            >
              {range} kun
            </Link>
          ))}
        </div>
      </div>

      <AnalyticsDashboard
        days={days}
        timeseries={timeseries}
        quality={quality}
        demographics={demographics}
        footfall={footfall}
        byCamera={byCamera}
      />
    </div>
  );
}
