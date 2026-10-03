import { Link } from "react-router-dom";
import { AlertTriangle, Server, ShieldAlert } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { PageHeader } from "@v2/components/page-header";
import { StatCard } from "@v2/components/stat-card";
import { EmptyState, ErrorState, LoadingRows, SectionCard, UnavailableNotice } from "@v2/components/feedback";
import { Badge } from "@v2/components/ui/badge";
import { Button } from "@v2/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@v2/components/ui/table";
import { chartAxisProps, chartTooltipStyle, useChartColors } from "@v2/components/chart";
import { useActiveWorkspace } from "@v2/data/workspace-context";
import { useFleetSnapshot, useMe } from "@v2/data/hooks";
import { useOctoData } from "@v2/data/provider";
import { formatBytes, formatCount, formatRelativeTime } from "@v2/lib/format";

export default function FleetPage() {
  const { mode } = useOctoData();
  const { setActiveWorkspaceId } = useActiveWorkspace();
  const fleet = useFleetSnapshot();
  const me = useMe();
  const colors = useChartColors();

  const isPlatformOwner = Boolean(me.data?.principal.isPlatformOwner);
  const snapshot = fleet.data;
  const rows = snapshot?.rows ?? [];

  const chartData = rows.slice(0, 8).map((row) => ({
    name: row.workspace.name.length > 14 ? `${row.workspace.name.slice(0, 13)}…` : row.workspace.name,
    active: Number((row.activeR2Bytes / 1024 / 1024).toFixed(1)),
    archived: Number((row.archivedDriveBytes / 1024 / 1024).toFixed(1)),
  }));

  const totalBytes = rows.reduce((sum, row) => sum + row.usedBytes, 0);
  const totalFiles = rows.reduce((sum, row) => sum + row.fileCount, 0);
  const totalFailed = rows.reduce((sum, row) => sum + row.failedJobs, 0);
  const needsAttention = rows.filter((row) => row.failedJobs > 0).length;

  if (!isPlatformOwner && mode !== "demo") {
    return (
      <>
        <PageHeader title="Fleet" description="Owner-only cross-workspace view." />
        <EmptyState
          icon={ShieldAlert}
          title="Platform-owner access required"
          description="This identity is not a platform owner, so no fleet summary is available. A workspace selector is never treated as permission."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Fleet"
        description="Compare the workspaces returned for the authenticated identity. A platform-owner identity is an operator role — it is not a larger storage plan or quota."
        actions={mode === "demo" ? <Badge variant="warning">Demo data</Badge> : null}
      />

      {fleet.isLoading ? (
        <LoadingRows rows={6} />
      ) : fleet.isError ? (
        <ErrorState error={fleet.error} onRetry={() => void fleet.refetch()} />
      ) : snapshot && !snapshot.available ? (
        <>
          <UnavailableNotice
            icon={AlertTriangle}
            title="Fleet totals are not available"
            description={snapshot.reason ?? "No aggregate endpoint is implemented."}
          />
          <SectionCard
            title="Why this is empty"
            description="What a connected implementation would need before this view can show real numbers."
          >
            <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-muted-foreground">
              <li>An owner-authorized aggregate endpoint, for example <code className="font-mono text-xs">GET /api/fleet/usage</code>.</li>
              <li>Per-workspace totals computed server-side from canonical file metadata.</li>
              <li>
                A tenant client must never fan out from the browser to private workspace endpoints to
                synthesise a fleet total.
              </li>
            </ul>
          </SectionCard>
        </>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Authorized workspaces"
              icon={Server}
              demo={mode === "demo"}
              value={formatCount(rows.length)}
              hint="Only workspaces the API returns for this identity."
            />
            <StatCard
              label="Fleet recorded usage"
              icon={Server}
              demo={mode === "demo"}
              value={formatBytes(totalBytes)}
              hint="Sum of catalog metadata across visible workspaces."
            />
            <StatCard
              label="Catalogued files"
              demo={mode === "demo"}
              value={formatCount(totalFiles)}
              hint="Active, non-deleted records."
            />
            <StatCard
              label="Needs attention"
              demo={mode === "demo"}
              value={formatCount(needsAttention)}
              hint={`${totalFailed} failed job(s) across the fleet.`}
            />
          </div>

          <SectionCard
            title="Recorded usage by workspace"
            description="Active R2 versus archived Drive bytes, in megabytes."
            actions={mode === "demo" ? <Badge variant="warning">Demo data</Badge> : null}
          >
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="name" {...chartAxisProps} />
                  <YAxis {...chartAxisProps} tickFormatter={(value: number) => `${value} MB`} />
                  <RechartsTooltip
                    contentStyle={chartTooltipStyle}
                    labelStyle={{ color: "var(--color-foreground)" }}
                    cursor={{ fill: "var(--color-muted)" }}
                    formatter={(value, key) => [
                      `${value} MB`,
                      key === "active" ? "Active · R2" : "Archived · Drive",
                    ]}
                  />
                  <Bar dataKey="active" stackId="a" fill={colors[0]} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="archived" stackId="a" fill={colors[1]} radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </SectionCard>

          <SectionCard
            title="Workspace comparison"
            description="Drill into any workspace to inspect its own views."
          >
            {rows.length === 0 ? (
              <EmptyState
                icon={Server}
                title="No visible workspaces"
                description="The aggregate returned no workspaces for this identity."
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Workspace</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-right">Files</TableHead>
                    <TableHead className="text-right">Recorded</TableHead>
                    <TableHead className="text-right">Failed jobs</TableHead>
                    <TableHead>Last activity</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.workspace.id}>
                      <TableCell>
                        <span className="flex flex-col">
                          <span className="font-medium">{row.workspace.name}</span>
                          <code className="font-mono text-[11px] text-muted-foreground">
                            {row.workspace.slug}
                          </code>
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={row.workspace.isOwner ? "default" : "outline"}>
                          {row.workspace.role}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatCount(row.fileCount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatBytes(row.usedBytes)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.failedJobs > 0 ? (
                          <span className="text-destructive">{row.failedJobs}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {row.lastActivityAt ? formatRelativeTime(row.lastActivityAt) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          asChild
                          onClick={() => setActiveWorkspaceId(row.workspace.id)}
                        >
                          <Link to="/">Open</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </SectionCard>
        </>
      )}
    </>
  );
}
