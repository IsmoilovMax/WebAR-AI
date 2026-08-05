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
    <header className="flex items-center justify-between gap-4 border-b border-surface-2 bg-surface-1 px-4 py-3">
      <Link href="/live" className="flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded-md bg-brand/20 text-brand">
          <svg viewBox="0 0 20 20" fill="currentColor" className="size-4" aria-hidden>
            <path d="M4 5h9l3 3v7H4z" opacity={0.6} />
            <circle cx="9" cy="10" r="2.5" />
          </svg>
        </span>
        <span className="text-sm font-semibold">AI Video Analitika</span>
      </Link>

      <div className="flex items-center gap-3">
        {/* AI servisi pastga tushsa, kameralar "jonli" ko'rinsa ham hech
            narsa tahlil qilinmayapti. Buni yashirish xavfli. */}
        {workerOnline ? null : (
          <Badge tone="danger">AI servisi javob bermayapti</Badge>
        )}

        {unresolvedCount > 0 ? (
          <Link href="/events?status=new">
            <Badge tone="warning">{unresolvedCount} ko'rilmagan</Badge>
          </Link>
        ) : null}

        <span className="hidden text-xs text-content-muted sm:inline">{user.email}</span>

        <form action={logout}>
          <Button variant="ghost" type="submit" className="px-2 py-1 text-xs">
            Chiqish
          </Button>
        </form>
      </div>
    </header>
  );
}
