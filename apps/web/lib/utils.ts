import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
  ["week", 4.348],
  ["month", 12],
  ["year", Number.POSITIVE_INFINITY],
];

export function relativeTime(value: string | Date, locale = "ko-KR"): string {
  const target = typeof value === "string" ? new Date(value) : value;
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  let delta = (target.getTime() - Date.now()) / 1000;

  for (const [unit, limit] of RELATIVE_UNITS) {
    if (Math.abs(delta) < limit) {
      return formatter.format(Math.round(delta), unit);
    }
    delta /= limit;
  }

  return formatter.format(Math.round(delta), "year");
}

export function formatDateTime(value: string | Date, locale = "ko-KR"): string {
  const target = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(target);
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}초`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}분 ${Math.round(seconds % 60)}초`;
  return `${Math.floor(seconds / 3600)}시간 ${Math.floor((seconds % 3600) / 60)}분`;
}
