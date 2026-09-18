"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Permission, Role, SessionUser } from "@acs/types";
import { hasPermission, ROLE_LABELS } from "@acs/types";
import { logout } from "@/app/(dashboard)/actions";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  permission: Permission;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/live",
    label: "라이브",
    permission: "camera:read",
    icon: "M2 5h16v10H2z M6 19h8",
  },
  {
    href: "/events",
    label: "이벤트",
    permission: "event:read",
    icon: "M10 2v8l5 3",
  },
  {
    href: "/analytics",
    label: "대시보드",
    permission: "analytics:read",
    icon: "M3 17V8m5 9V4m5 13v-6m5 6V9",
  },
  {
    href: "/cameras",
    label: "장치",
    permission: "camera:read",
    icon: "M4 6h12v9H4z M8 10.5a2 2 0 104 0 2 2 0 00-4 0",
  },
  {
    href: "/settings",
    label: "설정",
    permission: "alert:read",
    icon: "M10 13a3 3 0 100-6 3 3 0 000 6z M3.5 10a6.5 6.5 0 1013 0 6.5 6.5 0 00-13 0",
  },
];

function visibleItems(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => hasPermission(role, item.permission));
}

export function Sidebar({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const items = visibleItems(user.role);

  return (
    <nav
      aria-label="주 탐색"
      className="flex shrink-0 flex-row gap-0.5 border-t border-surface-2 bg-surface-1 md:h-full md:w-56 md:flex-col md:border-r md:border-t-0"
    >
      <div className="hidden items-center gap-2 px-4 py-4 md:flex">
        <span className="grid size-7 place-items-center rounded text-brand">
          <svg viewBox="0 0 20 20" fill="currentColor" className="size-5" aria-hidden>
            <path d="M4 5h9l3 3v7H4z" opacity={0.55} />
            <circle cx="9" cy="10" r="2.5" />
          </svg>
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-content-primary">
            AI 영상 분석
          </p>
          <p className="truncate text-[11px] text-content-muted">{user.orgName}</p>
        </div>
      </div>

      <div className="flex flex-1 flex-row gap-0.5 p-1.5 md:flex-col md:overflow-y-auto md:px-2 md:py-1">
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex flex-1 items-center justify-center gap-2.5 rounded px-3 py-2 text-sm font-medium transition-colors md:flex-none md:justify-start",
                active
                  ? "bg-surface-2 text-content-primary"
                  : "text-content-secondary hover:bg-surface-2/60 hover:text-content-primary",
              )}
            >
              {active ? (
                <span
                  className="absolute inset-y-1.5 left-0 hidden w-0.5 rounded-full bg-white md:block"
                  aria-hidden
                />
              ) : null}
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={cn("size-[18px] shrink-0", active && "text-brand")}
                aria-hidden
              >
                <path d={item.icon} />
              </svg>
              <span className="hidden md:inline">{item.label}</span>
            </Link>
          );
        })}
      </div>

      <div className="mt-auto hidden border-t border-surface-2 p-3 md:block">
        <div className="mb-3 px-1">
          <p className="truncate text-xs font-medium text-content-primary">{user.email}</p>
          <p className="text-[11px] text-content-muted">{ROLE_LABELS[user.role]}</p>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center justify-center gap-2 rounded border border-brand/50 px-3 py-2 text-xs font-medium text-brand transition-colors hover:bg-brand/10"
          >
            로그아웃
          </button>
        </form>
      </div>
    </nav>
  );
}
