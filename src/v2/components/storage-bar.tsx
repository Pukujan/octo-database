import { cn } from "@v2/lib/utils";
import { formatBytes, formatPercent } from "@v2/lib/format";

interface Segment {
  key: string;
  label: string;
  bytes: number;
  className: string;
}

export function StorageBar({
  usedBytes,
  activeR2Bytes,
  archivedDriveBytes,
  transitioningBytes,
  className,
  compact = false,
}: {
  usedBytes: number;
  activeR2Bytes: number;
  archivedDriveBytes: number;
  transitioningBytes: number;
  className?: string;
  compact?: boolean;
}) {
  const segments: Segment[] = [
    { key: "active", label: "Active (R2)", bytes: activeR2Bytes, className: "bg-primary" },
    { key: "archived", label: "Archived (Drive)", bytes: archivedDriveBytes, className: "bg-chart-2" },
    {
      key: "transitioning",
      label: "Transitioning",
      bytes: transitioningBytes,
      className: "bg-chart-4",
    },
  ];

  const total = segments.reduce((sum, segment) => sum + segment.bytes, 0);
  const visible = segments.filter((segment) => segment.bytes > 0);

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
        {total === 0 ? null : (
          visible.map((segment) => (
            <div
              key={segment.key}
              className={cn("h-full", segment.className)}
              style={{ width: `${(segment.bytes / total) * 100}%` }}
              title={`${segment.label}: ${formatBytes(segment.bytes)}`}
            />
          ))
        )}
      </div>

      <div className={cn("grid gap-2", compact ? "grid-cols-3" : "grid-cols-1 sm:grid-cols-3")}>
        {segments.map((segment) => (
          <div key={segment.key} className="flex items-center gap-2">
            <span className={cn("size-2.5 shrink-0 rounded-full", segment.className)} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-xs text-muted-foreground">{segment.label}</span>
              <span className="text-sm font-medium tabular-nums">
                {formatBytes(segment.bytes)}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  {total > 0 ? formatPercent(segment.bytes / total) : "0%"}
                </span>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
