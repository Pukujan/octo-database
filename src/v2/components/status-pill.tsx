import type { ArchiveState, JobState, WorkspaceRole } from "@v2/types/octo";
import { Badge, type BadgeProps } from "@v2/components/ui/badge";

const ARCHIVE_LABELS: Record<ArchiveState, { label: string; variant: BadgeProps["variant"] }> = {
  active_r2: { label: "Active · R2", variant: "success" },
  archiving: { label: "Archiving", variant: "warning" },
  archived_drive: { label: "Archived · Drive", variant: "default" },
  restoring: { label: "Restoring", variant: "warning" },
  reconciliation_required: { label: "Needs reconciliation", variant: "destructive" },
};

export function ArchiveStatePill({ state }: { state?: string }) {
  const known = state ? ARCHIVE_LABELS[state as ArchiveState] : undefined;
  if (!known) {
    return <Badge variant="muted">{state ?? "Unknown"}</Badge>;
  }
  return <Badge variant={known.variant}>{known.label}</Badge>;
}

const JOB_LABELS: Record<JobState, { label: string; variant: BadgeProps["variant"] }> = {
  queued: { label: "Queued", variant: "muted" },
  running: { label: "Running", variant: "default" },
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
  paused: { label: "Paused", variant: "warning" },
};

export function JobStatePill({ state }: { state: JobState }) {
  const known = JOB_LABELS[state];
  return <Badge variant={known.variant}>{known.label}</Badge>;
}

const ROLE_VARIANTS: Record<WorkspaceRole, BadgeProps["variant"]> = {
  owner: "default",
  admin: "default",
  operator: "outline",
  member: "outline",
};

export function RolePill({ role, isOwner }: { role: WorkspaceRole; isOwner: boolean }) {
  return (
    <Badge variant={ROLE_VARIANTS[role]}>
      {role}
      {isOwner ? " · workspace owner" : ""}
    </Badge>
  );
}

export function PlatformOwnerPill() {
  return <Badge variant="warning">Platform owner</Badge>;
}
