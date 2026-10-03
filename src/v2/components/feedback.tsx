import * as React from "react";
import { AlertTriangle, Database, Info, Inbox, Loader2, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@v2/components/ui/alert";
import { Badge } from "@v2/components/ui/badge";
import { Button } from "@v2/components/ui/button";
import { Skeleton } from "@v2/components/ui/skeleton";
import { cn } from "@v2/lib/utils";

/**
 * Marks any illustrative value so a prototype can never be mistaken for a
 * connected deployment (a hard requirement of the dashboard brief).
 */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <Badge variant="warning" className={className} title="Illustrative fixture value">
      Demo data
    </Badge>
  );
}

export function MetricLabel({
  label,
  demo,
  hint,
  className,
}: {
  label: string;
  demo?: boolean;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {demo ? <DemoBadge /> : null}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

/**
 * Renders an honest "we do not have this" state. Never renders zero or
 * "unlimited" for a metric the backend does not collect.
 */
export function UnavailableNotice({
  title,
  description,
  icon: Icon = Info,
  className,
}: {
  title: string;
  description: string;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-2 rounded-lg border border-dashed border-border bg-muted/30 p-4",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">{title}</span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}

export function QuotaNotConfigured({ className }: { className?: string }) {
  return (
    <UnavailableNotice
      className={className}
      icon={Database}
      title="Quota not configured"
      description="No workspace or principal quota exists in the current contract. retentionDays is an archive policy, not a storage limit. This is not zero and not unlimited."
    />
  );
}

export function TelemetryNotCollected({ className }: { className?: string }) {
  return (
    <UnavailableNotice
      className={className}
      icon={Info}
      title="Telemetry not collected"
      description="No request instrumentation or retained time-series exists yet, so latency, throughput, error rate, and uptime history cannot be shown."
    />
  );
}

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  className,
}: {
  title: string;
  description: string;
  icon?: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/40 px-6 py-14 text-center",
        className,
      )}
    >
      <div className="flex size-11 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Could not load this data",
  error,
  onRetry,
  className,
}: {
  title?: string;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const message = error instanceof Error ? error.message : "An unknown error occurred.";
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  const isAuth = status === 401 || status === 403;

  return (
    <Alert variant={isAuth ? "warning" : "destructive"} className={className}>
      {isAuth ? <ShieldAlert /> : <AlertTriangle />}
      <div className="flex flex-1 flex-col gap-1">
        <AlertTitle>{isAuth ? "Not authorized" : title}</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </div>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </Alert>
  );
}

export function LoadingRows({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <Skeleton key={index} className="h-11 w-full" />
      ))}
    </div>
  );
}

export function InlineSpinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-muted-foreground", className)} />;
}

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("rounded-xl border border-border bg-card text-card-foreground shadow-sm", className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {description ? (
            <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}
