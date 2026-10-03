import { Activity, Play, RefreshCw, TriangleAlert } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@v2/components/page-header";
import { StatCard } from "@v2/components/stat-card";
import { EmptyState, ErrorState, LoadingRows, SectionCard, TelemetryNotCollected } from "@v2/components/feedback";
import { JobStatePill } from "@v2/components/status-pill";
import { Badge } from "@v2/components/ui/badge";
import { Button } from "@v2/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@v2/components/ui/table";
import { chartAxisProps, chartTooltipStyle, useChartColors } from "@v2/components/chart";
import { useActiveWorkspace } from "@v2/data/workspace-context";
import { useActivity, useJobs, useRetryJob, useRunWorker } from "@v2/data/hooks";
import { useOctoData } from "@v2/data/provider";
import { formatDateTime, formatDuration, formatRelativeTime } from "@v2/lib/format";
import type { JobState } from "@v2/types/octo";

const STATES: JobState[] = ["queued", "running", "completed", "failed", "paused"];

export default function OperationsPage() {
  const { activeWorkspace } = useActiveWorkspace();
  const { mode } = useOctoData();
  const workspaceId = activeWorkspace?.id ?? null;
  const demo = mode === "demo";
  const colors = useChartColors();

  const jobs = useJobs(workspaceId);
  const activity = useActivity(workspaceId);
  const retry = useRetryJob(workspaceId);
  const runWorker = useRunWorker(workspaceId);

  const rows = jobs.data ?? [];
  const counts = STATES.map((state) => ({
    state,
    count: rows.filter((job) => job.state === state).length,
  }));
  const failures = rows.filter((job) => job.state === "failed");
  const colourFor = (state: JobState) =>
    state === "failed"
      ? colors[4]
      : state === "completed"
        ? colors[1]
        : state === "running"
          ? colors[0]
          : state === "paused"
            ? colors[3]
            : colors[2];

  return (
    <>
      <PageHeader
        title="Operations"
        description="Background job queue and workspace activity. Timestamps support job age and completion age only — they do not separate queue wait from execution time."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runWorker.mutateAsync()}
              disabled={!workspaceId || runWorker.isPending}
            >
              <Play className="size-4" />
              {runWorker.isPending ? "Running…" : "Run worker pass"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void jobs.refetch()}
              disabled={jobs.isFetching}
            >
              <RefreshCw className={jobs.isFetching ? "size-4 animate-spin" : "size-4"} />
              Refresh
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Queued"
          demo={demo}
          value={String(counts.find((entry) => entry.state === "queued")?.count ?? 0)}
          hint="Waiting for a worker pass."
        />
        <StatCard
          label="Running"
          demo={demo}
          value={String(counts.find((entry) => entry.state === "running")?.count ?? 0)}
          hint="Held under a lease."
        />
        <StatCard
          label="Failed"
          demo={demo}
          value={String(failures.length)}
          hint={failures.length > 0 ? "Retry available below." : "Nothing failed."}
        />
        <StatCard
          label="Completed (recent window)"
          demo={demo}
          value={String(counts.find((entry) => entry.state === "completed")?.count ?? 0)}
          hint="The API returns the most recent 50 jobs."
        />
      </div>

      {jobs.isError ? <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} /> : null}

      <div className="grid gap-6 xl:grid-cols-3">
        <SectionCard
          className="xl:col-span-2"
          title="Queue by state"
          description="Counts within the recent window returned by the API."
          actions={demo ? <Badge variant="warning">Demo data</Badge> : null}
        >
          {jobs.isLoading ? (
            <LoadingRows rows={5} />
          ) : (
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={counts} margin={{ top: 8, right: 8, bottom: 0, left: -22 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="state" {...chartAxisProps} />
                  <YAxis {...chartAxisProps} allowDecimals={false} />
                  <RechartsTooltip
                    contentStyle={chartTooltipStyle}
                    labelStyle={{ color: "var(--color-foreground)" }}
                    cursor={{ fill: "var(--color-muted)" }}
                  />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {counts.map((entry) => (
                      <Cell key={entry.state} fill={colourFor(entry.state)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>

        <SectionCard title="Queue timing" description="Queue wait versus execution duration.">
          <TelemetryNotCollected />
        </SectionCard>
      </div>

      <SectionCard
        title="Failed jobs"
        description="Understand the failure and re-enqueue the job. Retry resets the attempt counter."
      >
        {jobs.isLoading ? (
          <LoadingRows rows={4} />
        ) : failures.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No failed jobs"
            description="Every job in the recent window is queued, running, or completed."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Age</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failures.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="font-medium">{job.jobType}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {job.attempt} / {job.maxAttempts}
                  </TableCell>
                  <TableCell className="max-w-[20rem]">
                    <span className="flex items-center gap-2 text-xs text-destructive">
                      <TriangleAlert className="size-3.5 shrink-0" />
                      <span className="truncate">{job.errorSummary ?? job.errorCode ?? "Unknown"}</span>
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatDuration(job.createdAt, job.completedAt ?? new Date().toISOString())}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={retry.isPending}
                      onClick={() => void retry.mutateAsync(job.id)}
                    >
                      <RefreshCw className="size-3.5" />
                      Retry
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <div className="grid gap-6 xl:grid-cols-2">
        <SectionCard title="All recent jobs" description="Newest first, as returned by the API.">
          {jobs.isLoading ? (
            <LoadingRows rows={6} />
          ) : rows.length === 0 ? (
            <EmptyState icon={Activity} title="No jobs" description="Nothing is queued for this workspace." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.slice(0, 10).map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="font-medium">{job.jobType}</TableCell>
                    <TableCell>
                      <JobStatePill state={job.state} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-xs text-muted-foreground">
                      {formatDateTime(job.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>

        <SectionCard title="Activity feed" description="Newest workspace events.">
          {activity.isLoading ? (
            <LoadingRows rows={6} />
          ) : (activity.data ?? []).length === 0 ? (
            <EmptyState icon={Activity} title="No activity" description="Events appear as work happens." />
          ) : (
            <ol className="flex flex-col gap-3">
              {(activity.data ?? []).slice(0, 12).map((event) => (
                <li key={event.id} className="flex gap-3">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-sm">{event.summary}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {event.eventType} · {formatRelativeTime(event.createdAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </SectionCard>
      </div>
    </>
  );
}
