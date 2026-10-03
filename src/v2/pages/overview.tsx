import { Link } from "react-router-dom";
import { Activity, AlertTriangle, Files, HardDrive, ShieldCheck, Timer } from "lucide-react";
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
import { ArchiveStatePill, RolePill } from "@v2/components/status-pill";
import { Badge } from "@v2/components/ui/badge";
import { Button } from "@v2/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@v2/components/ui/table";
import { useActiveWorkspace } from "@v2/data/workspace-context";
import { useActivity, useFiles, useJobs, useMe, useStorageSnapshot } from "@v2/data/hooks";
import { useOctoData } from "@v2/data/provider";
import { formatBytes, formatCount, formatRelativeTime } from "@v2/lib/format";

export default function OverviewPage() {
  const { activeWorkspace } = useActiveWorkspace();
  const { mode } = useOctoData();
  const workspaceId = activeWorkspace?.id ?? null;
  const demo = mode === "demo";

  const storage = useStorageSnapshot(workspaceId);
  const files = useFiles(workspaceId);
  const jobs = useJobs(workspaceId);
  const activity = useActivity(workspaceId);
  const me = useMe();

  const jobRows = jobs.data ?? [];
  const failed = jobRows.filter((job) => job.state === "failed").length;
  const open = jobRows.filter((job) => job.state === "queued" || job.state === "running").length;

  if (!activeWorkspace) {
    return (
      <>
        <PageHeader title="Overview" description="No workspace is selected for this identity." />
        <EmptyState
          title="No authorized workspace"
          description="The API returned no workspaces for this session. Sign in again, or switch the data source to the demo fixtures to explore the portal."
          icon={ShieldCheck}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={activeWorkspace.name}
        description={
          activeWorkspace.description ??
          "Workspace overview: recorded usage, background jobs, and recent activity."
        }
        actions={
          <>
            <RolePill role={activeWorkspace.role} isOwner={activeWorkspace.isOwner} />
            {me.data?.principal.isPlatformOwner ? (
              <Badge variant="warning">Platform owner</Badge>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Recorded file usage"
          icon={HardDrive}
          demo={demo}
          value={storage.isLoading ? "…" : formatBytes(storage.snapshot?.usedBytes ?? 0)}
          hint="Catalog metadata sum — not physical bucket usage."
        />
        <StatCard
          label="Catalogued files"
          icon={Files}
          demo={demo}
          value={storage.isLoading ? "…" : formatCount(storage.snapshot?.fileCount ?? 0)}
          hint="Active, non-deleted catalog records."
        />
        <StatCard
          label="Open jobs"
          icon={Timer}
          demo={demo}
          value={formatCount(open)}
          hint="Queued or currently running."
        />
        <StatCard
          label="Failed jobs"
          icon={AlertTriangle}
          demo={demo}
          value={formatCount(failed)}
          hint={failed > 0 ? "Retry from Operations." : "Nothing needs attention."}
          footer={
            failed > 0 ? (
              <Link to="/operations" className="text-primary underline-offset-4 hover:underline">
                Review failures
              </Link>
            ) : null
          }
        />
      </div>

      {storage.isError ? (
        <ErrorState error={storage} onRetry={() => void files.refetch()} />
      ) : null}

      <div className="grid gap-6 xl:grid-cols-3">
        <SectionCard
          className="xl:col-span-2"
          title="Storage tiers"
          description="Catalog records split by archive state. Transitioning files are shown separately so they are never double counted."
          actions={demo ? <Badge variant="warning">Demo data</Badge> : null}
        >
          {storage.isLoading ? (
            <LoadingRows rows={3} />
          ) : (
            <StorageBar
              usedBytes={storage.snapshot?.usedBytes ?? 0}
              activeR2Bytes={storage.snapshot?.activeR2Bytes ?? 0}
              archivedDriveBytes={storage.snapshot?.archivedDriveBytes ?? 0}
              transitioningBytes={storage.snapshot?.transitioningBytes ?? 0}
            />
          )}
        </SectionCard>

        <SectionCard
          title="Quota"
          description="Whether a storage limit exists for this workspace."
        >
          <QuotaNotConfigured />
        </SectionCard>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <SectionCard
          className="xl:col-span-2"
          title="Recently added files"
          description="Newest catalog records for this workspace."
          actions={
            <Button variant="outline" size="sm" asChild>
              <Link to="/files">Open Files</Link>
            </Button>
          }
        >
          {files.isLoading ? (
            <LoadingRows rows={5} />
          ) : files.isError ? (
            <ErrorState error={files.error} onRetry={() => void files.refetch()} />
          ) : (files.data ?? []).length === 0 ? (
            <EmptyState
              icon={Files}
              title="No files yet"
              description="Upload a file from the Files view and it will appear here immediately."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Storage</TableHead>
                  <TableHead className="text-right">Added</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(files.data ?? []).slice(0, 6).map((file) => (
                  <TableRow key={file.id}>
                    <TableCell className="max-w-[16rem] truncate font-medium">{file.name}</TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {formatBytes(file.sizeBytes)}
                    </TableCell>
                    <TableCell>
                      <ArchiveStatePill state={file.archiveState} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-muted-foreground">
                      {formatRelativeTime(file.createdAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>

        <SectionCard
          title="Recent activity"
          description="Newest workspace events."
          actions={
            <Button variant="outline" size="sm" asChild>
              <Link to="/operations">Operations</Link>
            </Button>
          }
        >
          {activity.isLoading ? (
            <LoadingRows rows={5} />
          ) : (activity.data ?? []).length === 0 ? (
            <EmptyState icon={Activity} title="No activity yet" description="Workspace events will appear here." />
          ) : (
            <ol className="flex flex-col gap-3">
              {(activity.data ?? []).slice(0, 7).map((event) => (
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

      <div className="grid gap-6 xl:grid-cols-3">
        <SectionCard
          className="xl:col-span-2"
          title="Service status"
          description="Point-in-time connectivity check. Not a tenant metric and not an uptime guarantee."
        >
          <TelemetryNotCollected />
        </SectionCard>
        <SectionCard title="Workspace policy" description="Retention is an archive policy, not a quota.">
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Retention window</span>
              <span className="font-medium">
                {activeWorkspace.retentionDays ? `${activeWorkspace.retentionDays} days` : "Not set"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Workspace slug</span>
              <code className="font-mono text-xs">{activeWorkspace.slug}</code>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Your role</span>
              <span className="font-medium">{activeWorkspace.role}</span>
            </div>
          </div>
        </SectionCard>
      </div>
    </>
  );
}
