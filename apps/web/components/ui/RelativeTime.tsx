"use client";

import { useEffect, useState } from "react";
import { formatDateTime, relativeTime } from "@/lib/utils";

/**
 * Nisbiy vaqt faqat brauzerda hisoblanadi — SSR va hydration mos kelishi uchun.
 */
export function RelativeTime({
  value,
  className,
}: {
  value: string | Date;
  className?: string;
}) {
  const iso = typeof value === "string" ? value : value.toISOString();
  const [text, setText] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => {
      setText(relativeTime(iso));
      setTitle(formatDateTime(iso));
    };
    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [iso]);

  return (
    <time dateTime={iso} title={title ?? undefined} className={className}>
      {text ?? "…"}
    </time>
  );
}
