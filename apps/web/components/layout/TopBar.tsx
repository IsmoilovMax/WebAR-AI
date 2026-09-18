import Link from "next/link";
import type { SessionUser } from "@acs/types";
import { logout } from "@/app/(dashboard)/actions";
import { Badge, Button } from "@/components/ui/primitives";

export function TopBar({
  user,
  workerOnline,
  unresolvedCount,
}: {
  user: SessionUser;
  workerOnline: boolean;
  unresolvedCount: number;
}) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-surface-2 bg-surface-1 px-4 py-2.5">
      <div className="flex items-center gap-2 md:hidden">
        <span className="grid size-6 place-items-center text-brand">
          <svg viewBox="0 0 20 20" fill="currentColor" className="size-4" aria-hidden>
            <path d="M4 5h9l3 3v7H4z" opacity={0.55} />
            <circle cx="9" cy="10" r="2.5" />
          </svg>
        </span>
        <span className="text-sm font-semibold">AI 영상 분석</span>
      </div>

      <div className="hidden text-xs text-content-muted md:block">
        {user.orgName}
      </div>

      <div className="flex items-center gap-2.5">
        {workerOnline ? null : (
          <Badge tone="danger">AI 서비스 응답 없음</Badge>
        )}

        {unresolvedCount > 0 ? (
          <Link href="/events?status=new">
            <Badge tone="warning">{unresolvedCount}건 미확인</Badge>
          </Link>
        ) : null}

        <span className="hidden text-xs text-content-muted lg:inline">{user.email}</span>

        <form action={logout} className="md:hidden">
          <Button variant="ghost" type="submit" className="px-2 py-1 text-xs">
            로그아웃
          </Button>
        </form>
      </div>
    </header>
  );
}
