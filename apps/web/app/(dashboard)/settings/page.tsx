import type { Metadata } from "next";
import Link from "next/link";
import { hasPermission } from "@acs/types";
import {
  AlertsPanel,
  AuditPanel,
  BillingPanel,
  EdgePanel,
  ModelsPanel,
  UsersPanel,
} from "@/components/settings/SettingsPanels";
import { requireSession } from "@/lib/auth/guard";
import { listAlertRules, recentDeliveries } from "@/lib/data/alerts";
import { feedbackSummary } from "@/lib/data/feedback";
import {
  getOrganization,
  listAuditLog,
  listEdgeNodes,
  listModelVersions,
  listSites,
} from "@/lib/data/org";
import { listOrgUsers } from "@/lib/data/users";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "설정" };

const TABS = [
  { id: "alerts", label: "알림", permission: "alert:read" as const },
  { id: "users", label: "사용자", permission: "user:read" as const },
  { id: "models", label: "모델", permission: "alert:read" as const },
  { id: "edge", label: "엣지", permission: "billing:read" as const },
  { id: "billing", label: "결제", permission: "billing:read" as const },
  { id: "audit", label: "감사", permission: "audit:read" as const },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const session = await requireSession();
  const { tab: tabRaw } = await searchParams;

  const visibleTabs = TABS.filter((tab) => hasPermission(session.role, tab.permission));
  const tab = (
    visibleTabs.some((t) => t.id === tabRaw) ? tabRaw : visibleTabs[0]?.id
  ) as TabId | undefined;

  const org = await getOrganization(session.orgId);
  if (!org) throw new Error("조직을 찾을 수 없습니다");

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <h1 className="text-lg font-semibold">설정</h1>

      <div className="flex flex-wrap gap-1 rounded bg-surface-1 p-1 ring-1 ring-surface-2">
        {visibleTabs.map((item) => (
          <Link
            key={item.id}
            href={`/settings?tab=${item.id}`}
            className={cn(
              "rounded px-3 py-1.5 text-xs font-medium",
              tab === item.id
                ? "bg-brand/15 text-brand"
                : "text-content-secondary hover:text-content-primary",
            )}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {tab === "alerts" ? (
        <AlertsPanel
          rules={await listAlertRules(session.orgId)}
          deliveries={await recentDeliveries(session.orgId)}
          canWrite={hasPermission(session.role, "alert:write")}
        />
      ) : null}

      {tab === "users" && hasPermission(session.role, "user:read") ? (
        <UsersPanel
          users={await listOrgUsers(session.orgId)}
          canWrite={hasPermission(session.role, "user:write")}
        />
      ) : null}

      {tab === "models" ? (
        <ModelsPanel
          models={await listModelVersions(session.orgId)}
          feedback={await feedbackSummary(session.orgId)}
          canWrite={hasPermission(session.role, "alert:write")}
        />
      ) : null}

      {tab === "edge" && hasPermission(session.role, "billing:read") ? (
        <EdgePanel
          nodes={await listEdgeNodes(session.orgId)}
          sites={await listSites(session.orgId)}
          canWrite={hasPermission(session.role, "billing:write")}
        />
      ) : null}

      {tab === "billing" && hasPermission(session.role, "billing:read") ? (
        <BillingPanel
          org={org}
          canWrite={hasPermission(session.role, "billing:write")}
        />
      ) : null}

      {tab === "audit" && hasPermission(session.role, "audit:read") ? (
        <AuditPanel entries={await listAuditLog(session.orgId)} />
      ) : null}
    </div>
  );
}
