import { HardDrive, Layers, TrendingUp } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@v2/components/page-header";
import { StatCard } from "@v2/components/stat-card";
import { StorageBar } from "@v2/components/storage-bar";
import {
  EmptyState,
  ErrorState,
  LoadingRows,
  QuotaNotConfigured,
  SectionCard,
  TelemetryNotCollected,
} from "@v2/components/feedback";
import { ArchiveStatePill } from "@v2/components/status-pill";
import { Badge } from "@v2/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@v2/components/ui/table";
import { chartAxisProps, chartTooltipStyle, useChartColors } from "@v2/components/chart";
import { useActiveWorkspace } from "@v2/data/workspace-context";
import { useFiles, useStorageSnapshot } from "@v2/data/hooks";
import { useOctoData } from "@v2/data/provider";
import { formatBytes, formatCount, formatPercent } from "@v2/lib/format";

const ARCHIVE_STATE_LABELS: Record<string, string> = {
  active_r2: "Active · R2",
  archiving: "Archiving",
  archived_drive: "Archived · Drive",
  restoring: "Restoring",
  reconciliation_required: "Needs reconciliation",
};

/** Clearly labelled illustrative series — the contract has no retained samples. */
const DEMO_TREND = [
  { day: "Sep 04", recorded: 5.2 },
  { day: "Sep 09", recorded: 5.9 },
  { day: "Sep 14", recorded: 6.4 },
  { day: "Sep 19", recorded: 6.3 },
  { day: "Sep 24", recorded: 7.1 },
  { day: "Sep 29", recorded: 7.8 },
  { day: "Oct 03", recorded: 8.2 },
];

export default function StoragePage() {
  const { activeWorkspace } = useActiveWorkspace();
  const { mode } = useOctoData();
  const workspaceId = activeWorkspace?.id ?? null;
  const demo = mode === "demo";
  const colors = useChartColors();

  const storage = useStorageSnapshot(workspaceId);
  const files = useFiles(workspaceId);

  const snapshot = storage.snapshot;
  const rows = files.data ?? [];

  const byState = rows.reduce<Record<string, { count: number; bytes: number }>>((accumulator, file) => {
    const key = file.archiveState ?? "unknown";
    const entry = accumulator[key] ?? { count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += file.sizeBytes;
    accumulator[key] = entry;
    return accumulator;
  }, {});

  const tierEntries = Object.entries(byState).sort((a, b) => b[1].bytes - a[1].bytes);

  return (
    <>
      <PageHeader
        title="Storage"
        description="Recorded catalog usage for this workspace, split by storage tier. This is metadata accounting, not an R2 bill or a provider bucket inventory."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Recorded usage"
          icon={HardDrive}
          demo={demo}
          value={storage.isLoading ? "…" : formatBytes(snapshot?.usedBytes ?? 0)}
          hint="Sum of catalog sizeBytes for active records."
        />
        <StatCard
          label="Active · R2"
          icon={Layers}
          demo={demo}
          value={storage.isLoading ? "…" : formatBytes(snapshot?.activeR2Bytes ?? 0)}
          hint="Hot objects served directly."
        />
        <StatCard
          label="Archived · Drive"
          icon={Layers}
          demo={demo}
          value={storage.isLoading ? "…" : formatBytes(snapshot?.archivedDriveBytes ?? 0)}
          hint="Cold copies retained in Google Drive."
        />
        <StatCard
          label="Transitioning"
          icon={TrendingUp}
          demo={demo}
          value={storage.isLoading ? "…" : formatBytes(snapshot?.transitioningBytes ?? 0)}
          hint="Mid-archive or mid-restore; excluded from both tiers."
        />
      </div>

      {storage.isError ? <ErrorState error={storage} onRetry={() => void files.refetch()} /> : null}

      <div className="grid gap-6 xl:grid-cols-3">
        <SectionCard
          className="xl:col-span-2"
          title="Tier split"
          description="Mutually exclusive buckets that sum to the recorded total."
          actions={demo ? <Badge variant="warning">Demo data</Badge> : null}
        >
          {storage.isLoading ? (
            <LoadingRows rows={3} />
          ) : (
            <StorageBar
              usedBytes={snapshot?.usedBytes ?? 0}
              activeR2Bytes={snapshot?.activeR2Bytes ?? 0}
              archivedDriveBytes={snapshot?.archivedDriveBytes ?? 0}
              transitioningBytes={snapshot?.transitioningBytes ?? 0}
            />
          )}
        </SectionCard>

        <SectionCard title="Quota" description="A quota gauge appears only once the API returns limitBytes.">
          <QuotaNotConfigured />
        </SectionCard>
      </div>

      <SectionCard
        title="Breakdown by archive state"
        description="Every catalog record classified by its current storage tier."
      >
        {files.isLoading ? (
          <LoadingRows rows={5} />
        ) : tierEntries.length === 0 ? (
          <EmptyState
            icon={HardDrive}
            title="No catalog records"
            description="Upload a file to populate the storage breakdown."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>State</TableHead>
                <TableHead className="text-right">Files</TableHead>
                <TableHead className="text-right">Recorded bytes</TableHead>
                <TableHead className="text-right">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tierEntries.map(([state, entry]) => (
                <TableRow key={state}>
                  <TableCell>
                    <ArchiveStatePill state={state} />
                    <span className="ml-2 text-xs text-muted-foreground">
                      {ARCHIVE_STATE_LABELS[state] ?? "Unrecognised state"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatCount(entry.count)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatBytes(entry.bytes)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {(snapshot?.usedBytes ?? 0) > 0
                      ? formatPercent(entry.bytes / (snapshot?.usedBytes ?? 1))
                      : "0%"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-3">
        <SectionCard
          className="xl:col-span-2"
          title="Recorded usage over time"
          description="Illustrative only. The current contract keeps no retained aggregate samples, and deleting catalog rows can remove history."
          actions={<Badge variant="warning">Demo data</Badge>}
        >
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={DEMO_TREND} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <defs>
                  <linearGradient id="recordedFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={colors[0]} stopOpacity={0.45} />
                    <stop offset="100%" stopColor={colors[0]} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                <XAxis dataKey="day" {...chartAxisProps} />
                <YAxis {...chartAxisProps} tickFormatter={(value: number) => `${value} GB`} />
                <RechartsTooltip
                  contentStyle={chartTooltipStyle}
                  labelStyle={{ color: "var(--color-foreground)" }}
                  formatter={(value) => [`${value} GB (demo)`, "Recorded"]}
                />
                <Area
                  type="monotone"
                  dataKey="recorded"
                  stroke={colors[0]}
                  strokeWidth={2}
                  fill="url(#recordedFill)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </SectionCard>

        <SectionCard
          title="Provider telemetry"
          description="Latency, throughput, error rate, and uptime history."
        >
          <TelemetryNotCollected />
        </SectionCard>
      </div>
    </>
  );
}
