import type { ComponentProps, ReactNode } from "react";
import type { EventSeverity } from "@acs/types";
import { cn } from "@/lib/utils";

export function Panel({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("panel", className)} {...props} />;
}

export function PanelHeader({
  title,
  description,
  action,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-4 border-b border-surface-2 px-5 py-4">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-content-primary">{title}</h2>
        {description ? (
          <p className="mt-1 text-xs text-content-muted">{description}</p>
        ) : null}
      </div>
      {action}
    </header>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand text-surface-0 hover:bg-brand-strong",
  secondary: "bg-surface-2 text-content-primary hover:bg-surface-3",
  ghost: "text-content-secondary hover:bg-surface-2 hover:text-content-primary",
  danger: "bg-critical/15 text-critical hover:bg-critical/25",
};

export function Button({
  variant = "secondary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium",
        "transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

const SEVERITY_STYLES: Record<EventSeverity, string> = {
  critical: "bg-critical/15 text-critical ring-critical/30",
  high: "bg-high/15 text-high ring-high/30",
  medium: "bg-medium/15 text-medium ring-medium/30",
  low: "bg-low/15 text-low ring-low/30",
  info: "bg-surface-3 text-content-secondary ring-surface-3",
};

const SEVERITY_LABELS: Record<EventSeverity, string> = {
  critical: "Kritik",
  high: "Yuqori",
  medium: "O'rta",
  low: "Past",
  info: "Ma'lumot",
};

export function SeverityBadge({ severity }: { severity: EventSeverity }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset",
        SEVERITY_STYLES[severity],
      )}
    >
      {SEVERITY_LABELS[severity]}
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "brand";
  className?: string;
}) {
  const tones = {
    neutral: "bg-surface-2 text-content-secondary",
    success: "bg-low/15 text-low",
    warning: "bg-medium/15 text-medium",
    danger: "bg-critical/15 text-critical",
    brand: "bg-brand/15 text-brand",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({
  status,
  label,
}: {
  status: "online" | "offline" | "degraded" | "disabled";
  label?: string;
}) {
  const colors = {
    online: "bg-low",
    offline: "bg-critical",
    degraded: "bg-medium",
    disabled: "bg-content-muted",
  };

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-content-secondary">
      <span className={cn("size-2 rounded-full", colors[status])} aria-hidden />
      {label}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="text-sm font-medium text-content-secondary">{title}</p>
      {description ? (
        <p className="max-w-md text-xs text-content-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "danger" | "warning" | "success";
}) {
  const valueTones = {
    neutral: "text-content-primary",
    danger: "text-critical",
    warning: "text-medium",
    success: "text-low",
  };

  return (
    <div className="panel px-4 py-3">
      <p className="text-xs text-content-muted">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", valueTones[tone])}>
        {value}
      </p>
      {hint ? <p className="mt-1 text-[11px] text-content-muted">{hint}</p> : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-content-secondary">{label}</span>
      {children}
      {error ? (
        <span className="text-xs text-critical">{error}</span>
      ) : hint ? (
        <span className="text-xs text-content-muted">{hint}</span>
      ) : null}
    </label>
  );
}

const CONTROL_CLASS =
  "w-full rounded-lg border border-surface-3 bg-surface-0 px-3 py-2 text-sm " +
  "text-content-primary placeholder:text-content-muted focus:border-brand focus:outline-none";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(CONTROL_CLASS, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(CONTROL_CLASS, className)} {...props} />;
}
