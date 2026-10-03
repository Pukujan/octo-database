import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@v2/lib/utils";
import { DemoBadge } from "./feedback";

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  demo,
  footer,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon?: LucideIcon;
  demo?: boolean;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col justify-between gap-3 rounded-xl border border-border bg-card p-5 text-card-foreground shadow-sm",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {Icon ? (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Icon className="size-4 text-muted-foreground" />
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
          {demo ? <DemoBadge /> : null}
        </div>
        {hint ? <span className="text-xs leading-relaxed text-muted-foreground">{hint}</span> : null}
      </div>

      {footer ? <div className="text-xs text-muted-foreground">{footer}</div> : null}
    </div>
  );
}
