import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { requireSession } from "@/lib/auth/guard";
import { eventCounts } from "@/lib/data/events";
import { fetchWorkerStatus } from "@/lib/services/ai-worker";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

  // Ikkalasi mustaqil, shuning uchun parallel. Worker so'rovi timeout
  // bilan himoyalangan, u sekinlashsa ham dashboard ochiladi.
  const [counts, worker] = await Promise.all([
    eventCounts(session.orgId),
    fetchWorkerStatus(),
  ]);

  return (
    <div className="flex h-dvh flex-col">
      <TopBar
        user={session}
        workerOnline={worker !== null}
        unresolvedCount={counts.unresolved}
      />
      <div className="flex min-h-0 flex-1 flex-col-reverse md:flex-row">
        <Sidebar user={session} />
        <main className="min-h-0 flex-1 overflow-y-auto p-4">{children}</main>
      </div>
    </div>
  );
}
