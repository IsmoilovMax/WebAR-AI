"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Permission, Role, SessionUser } from "@acs/types";
import { hasPermission, ROLE_LABELS } from "@acs/types";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  permission: Permission;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/live", label: "Jonli", permission: "camera:read", icon: "M2 5h16v10H2z M6 19h8" },
  { href: "/events", label: "Hodisalar", permission: "event:read", icon: "M10 2v8l5 3" },
  { href: "/analytics", label: "Analitika", permission: "analytics:read", icon: "M3 17V8m5 9V4m5 13v-6m5 6V9" },
  { href: "/cameras", label: "Kameralar", permission: "camera:read", icon: "M4 6h12v9H4z M8 10.5a2 2 0 104 0 2 2 0 00-4 0" },
  { href: "/settings", label: "Sozlamalar", permission: "alert:read", icon: "M10 13a3 3 0 100-6 3 3 0 000 6z" },
];

function visibleItems(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => hasPermission(role, item.permission));
}

export function Sidebar({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const items = visibleItems(user.role);

  return (
    <nav
      aria-label="Asosiy navigatsiya"
      className="flex shrink-0 flex-row gap-1 border-t border-surface-2 bg-surface-1 p-2 md:h-full md:w-56 md:flex-col md:border-r md:border-t-0 md:p-3"
    >
      <div className="hidden px-2 py-3 md:block">
        <p className="text-sm font-semibold text-content-primary">{user.orgName}</p>
        <p className="text-xs text-content-muted">{ROLE_LABELS[user.role]}</p>
      </div>

      {items.map((item) => {
        const active = pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors md:flex-none md:justify-start",
              active
                ? "bg-brand/15 text-brand"
                : "text-content-secondary hover:bg-surface-2 hover:text-content-primary",
            )}
          >
            <svg
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.6}
              strokeLinecap="round"
              className="size-5 shrink-0"
              aria-hidden
            >
              <path d={item.icon} />
            </svg>
            <span className="hidden md:inline">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
