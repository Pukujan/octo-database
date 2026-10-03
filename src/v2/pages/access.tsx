import * as React from "react";
import { Check, Copy, KeyRound, Link2, Plug, ShieldCheck, Trash2 } from "lucide-react";
import { PageHeader } from "@v2/components/page-header";
import { EmptyState, ErrorState, LoadingRows, SectionCard } from "@v2/components/feedback";
import { RolePill } from "@v2/components/status-pill";
import { Badge } from "@v2/components/ui/badge";
import { Button } from "@v2/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@v2/components/ui/dialog";
import { Input } from "@v2/components/ui/input";
import { Label } from "@v2/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@v2/components/ui/select";
import { Switch } from "@v2/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@v2/components/ui/table";
import { useActiveWorkspace } from "@v2/data/workspace-context";
import {
  useCapabilities,
  useCreateApiKey,
  useKeys,
  useRevokeApiKey,
  useRevokeShare,
  useShares,
} from "@v2/data/hooks";
import { useOctoData } from "@v2/data/provider";
import { formatDateTime, formatRelativeTime, formatScopes } from "@v2/lib/format";

const SCOPE_PRESETS: Array<{ id: string; label: string; scopes: string[] }> = [
  { id: "read", label: "Read-only", scopes: ["files:read", "activity:read"] },
  { id: "write", label: "Read-write", scopes: ["files:read", "files:write", "jobs:read"] },
  { id: "ingest", label: "Ingest", scopes: ["files:read", "files:write", "jobs:run"] },
  { id: "full", label: "Full access", scopes: ["*"] },
];

export default function AccessPage() {
  const { activeWorkspace } = useActiveWorkspace();
  const { mode } = useOctoData();
  const workspaceId = activeWorkspace?.id ?? null;
  const demo = mode === "demo";

  const keys = useKeys();
  const shares = useShares(workspaceId);
  const capabilities = useCapabilities(workspaceId);
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();
  const revokeShare = useRevokeShare(workspaceId);

  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [accountWide, setAccountWide] = React.useState(false);
  const [preset, setPreset] = React.useState("write");
  const [revealed, setRevealed] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    const chosen = SCOPE_PRESETS.find((entry) => entry.id === preset);
    try {
      const result = await createKey.mutateAsync({
        name: name.trim() || "Untitled key",
        workspaceId: accountWide ? null : workspaceId,
        scopes: chosen?.scopes ?? ["files:read"],
        expiresInDays: null,
      });
      setRevealed(result.rawSecret);
      setName("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create the key.");
    }
  }

  return (
    <>
      <PageHeader
        title="Access"
        description="Workspace API keys, share links, and the callable capability surface. Browsers and agents never receive master provider credentials."
        actions={
          <>
            <RolePill role={activeWorkspace?.role ?? "member"} isOwner={Boolean(activeWorkspace?.isOwner)} />
            {demo ? <Badge variant="warning">Demo data</Badge> : null}
          </>
        }
      />

      <SectionCard
        title="API keys"
        description="Scoped machine identities. A raw secret is shown once at creation and never returned by list."
        actions={
          <Button size="sm" onClick={() => setOpen(true)}>
            <KeyRound className="size-4" />
            Create key
          </Button>
        }
      >
        {keys.isLoading ? (
          <LoadingRows rows={3} />
        ) : keys.isError ? (
          <ErrorState error={keys.error} onRetry={() => void keys.refetch()} />
        ) : (keys.data ?? []).length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title="No API keys"
            description="Create a scoped key for automation or an agent, then bind it to a workspace."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Prefix</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(keys.data ?? []).map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="font-medium">{key.name}</TableCell>
                  <TableCell>
                    <code className="font-mono text-xs text-muted-foreground">{key.prefix}</code>
                  </TableCell>
                  <TableCell>
                    {key.isAccountWide ? (
                      <Badge variant="warning">Account-wide</Badge>
                    ) : (
                      <Badge variant="outline">Workspace · {key.role ?? "member"}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatScopes(key.scopes)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {key.lastUsedAt ? formatRelativeTime(key.lastUsedAt) : "Never"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={revokeKey.isPending}
                      onClick={() => void revokeKey.mutateAsync(key.id)}
                    >
                      <Trash2 className="size-3.5" />
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <SectionCard
        title="Share links"
        description="Read-only gallery links. Revoking or expiring a link also invalidates the media it served."
      >
        {shares.isLoading ? (
          <LoadingRows rows={3} />
        ) : (shares.data ?? []).length === 0 ? (
          <EmptyState
            icon={Link2}
            title="No share links"
            description="Create a scoped link to publish a gallery read-only without exposing workspace access."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Resource</TableHead>
                <TableHead>Permission</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(shares.data ?? []).map((share) => (
                <TableRow key={share.id}>
                  <TableCell className="font-medium">{share.resourceType}</TableCell>
                  <TableCell className="text-muted-foreground">{share.permission}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {share.validUntil ? formatDateTime(share.validUntil) : "No expiry"}
                  </TableCell>
                  <TableCell>
                    {share.revokedAt ? (
                      <Badge variant="destructive">Revoked</Badge>
                    ) : share.active ? (
                      <Badge variant="success">Active</Badge>
                    ) : (
                      <Badge variant="muted">Expired</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={Boolean(share.revokedAt) || revokeShare.isPending}
                      onClick={() => void revokeShare.mutateAsync(share.id)}
                    >
                      Revoke
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <SectionCard
        title="Callable capabilities"
        description="Affordance guidance for the current credential. Every operation still enforces authorization server-side."
      >
        {capabilities.isLoading ? (
          <LoadingRows rows={5} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Capability</TableHead>
                <TableHead>Endpoint</TableHead>
                <TableHead>Scope</TableHead>
                <TableHead className="text-right">Availability</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(capabilities.data ?? []).map((capability) => (
                <TableRow key={capability.id}>
                  <TableCell>
                    <span className="flex flex-col">
                      <span className="font-medium">{capability.label}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {capability.description}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <code className="font-mono text-[11px] text-muted-foreground">
                      {capability.method} {capability.path}
                    </code>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {capability.scope ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {capability.available ? (
                      <Badge variant="success">Available</Badge>
                    ) : (
                      <Badge variant="muted">Not implemented</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <SectionCard
        title="Workspace details"
        description="Read-only summary. Deep administration stays in the provider consoles."
      >
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-muted-foreground">Name</span>
            <span className="font-medium">{activeWorkspace?.name ?? "—"}</span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-muted-foreground">Slug</span>
            <code className="font-mono text-xs">{activeWorkspace?.slug ?? "—"}</code>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-muted-foreground">Retention</span>
            <span className="font-medium">
              {activeWorkspace?.retentionDays ? `${activeWorkspace.retentionDays} days` : "Not set"}
            </span>
          </div>
          <div className="flex items-center justify-between border-b border-border pb-2">
            <span className="text-muted-foreground">Your role</span>
            <span className="font-medium">{activeWorkspace?.role ?? "—"}</span>
          </div>
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Membership management, database roles, and bucket policy are intentionally not recreated
            here — they live in the provider's own console.
          </span>
        </div>
      </SectionCard>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setRevealed(null);
            setCopied(false);
            setError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create an API key</DialogTitle>
            <DialogDescription>
              Bind the key to a workspace for least privilege, or make it account-wide when it must
              act across authorized workspaces.
            </DialogDescription>
          </DialogHeader>

          {revealed ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
                <Plug className="mt-0.5 size-3.5 shrink-0 text-warning" />
                <span>
                  Copy this secret now. It is shown once and never returned by the list endpoint.
                </span>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-3">
                <code className="min-w-0 flex-1 truncate font-mono text-xs">{revealed}</code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard?.writeText(revealed);
                    setCopied(true);
                  }}
                >
                  {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <DialogFooter>
                <Button onClick={() => setOpen(false)}>Done</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="key-name">Key name</Label>
                <Input
                  id="key-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Media ingest"
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div className="flex flex-col">
                  <span className="text-sm font-medium">Account-wide</span>
                  <span className="text-xs text-muted-foreground">
                    Authority is derived from live memberships, not asserted by the key.
                  </span>
                </div>
                <Switch checked={accountWide} onCheckedChange={setAccountWide} />
              </div>

              <div className="flex flex-col gap-2">
                <Label>Scope preset</Label>
                <Select value={preset} onValueChange={setPreset}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a preset" />
                  </SelectTrigger>
                  <SelectContent>
                    {SCOPE_PRESETS.map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-[11px] text-muted-foreground">
                  {formatScopes(
                    SCOPE_PRESETS.find((entry) => entry.id === preset)?.scopes ?? [],
                  )}
                </span>
              </div>

              {error ? (
                <p className="text-xs text-destructive">{error}</p>
              ) : null}

              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => void handleCreate()} disabled={createKey.isPending}>
                  {createKey.isPending ? "Creating…" : "Create key"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
