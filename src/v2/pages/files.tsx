import * as React from "react";
import {
  Archive,
  Download,
  Files as FilesIcon,
  MoreHorizontal,
  RotateCcw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { PageHeader } from "@v2/components/page-header";
import { EmptyState, ErrorState, LoadingRows, SectionCard } from "@v2/components/feedback";
import { ArchiveStatePill } from "@v2/components/status-pill";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@v2/components/ui/dropdown-menu";
import { Input } from "@v2/components/ui/input";
import { Label } from "@v2/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@v2/components/ui/table";
import { useActiveWorkspace } from "@v2/data/workspace-context";
import {
  useArchiveFile,
  useDeleteFile,
  useFiles,
  useRestoreFile,
  useUploadFile,
} from "@v2/data/hooks";
import { formatBytes, formatDateTime } from "@v2/lib/format";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.includes(",") ? result.split(",")[1]! : result);
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export default function FilesPage() {
  const { activeWorkspace } = useActiveWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;

  const files = useFiles(workspaceId);
  const upload = useUploadFile(workspaceId);
  const archiveFile = useArchiveFile(workspaceId);
  const restoreFile = useRestoreFile(workspaceId);
  const deleteFile = useDeleteFile(workspaceId);

  const [query, setQuery] = React.useState("");
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [pending, setPending] = React.useState<FileList | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  const rows = React.useMemo(() => {
    const all = files.data ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (file) =>
        file.name.toLowerCase().includes(needle) || file.mimeType.toLowerCase().includes(needle),
    );
  }, [files.data, query]);

  async function handleUpload() {
    if (!workspaceId || !pending || pending.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      for (const file of Array.from(pending)) {
        const data = await fileToBase64(file);
        await upload.mutateAsync({
          workspaceId,
          name: file.name,
          mimeType: file.type || "application/octet-stream",
          data,
          dataEncoding: "base64",
        });
      }
      setMessage(`Uploaded ${pending.length} file(s).`);
      setPending(null);
      setUploadOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<unknown>, label: string) {
    setMessage(null);
    try {
      await action();
      setMessage(`${label} completed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${label} failed.`);
    }
  }

  return (
    <>
      <PageHeader
        title="Files"
        description="Find, upload, archive, restore, or remove catalog records. Authorization is enforced server-side on every action."
        actions={
          <Button size="sm" onClick={() => setUploadOpen(true)} disabled={!workspaceId}>
            <Upload className="size-4" />
            Upload
          </Button>
        }
      />

      {message ? (
        <div className="rounded-lg border border-border bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
          {message}
        </div>
      ) : null}

      <SectionCard
        title="Catalog"
        description={`${rows.length} of ${files.data?.length ?? 0} record(s).`}
        actions={
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name or MIME type"
              className="h-8 w-56 pl-8 text-xs"
            />
          </div>
        }
      >
        {files.isLoading ? (
          <LoadingRows rows={8} />
        ) : files.isError ? (
          <ErrorState error={files.error} onRetry={() => void files.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={FilesIcon}
            title={query ? "No matching files" : "No files in this workspace"}
            description={
              query
                ? "Try a different search term."
                : "Upload a file to create the first catalog record."
            }
            action={
              query ? null : (
                <Button size="sm" onClick={() => setUploadOpen(true)}>
                  <Upload className="size-4" />
                  Upload a file
                </Button>
              )
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead>Storage</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((file) => {
                const archived = file.archiveState === "archived_drive";
                const moving = file.archiveState === "archiving" || file.archiveState === "restoring";
                return (
                  <TableRow key={file.id}>
                    <TableCell className="max-w-[18rem] truncate font-medium">{file.name}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {file.mimeType}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatBytes(file.sizeBytes)}</TableCell>
                    <TableCell>
                      <ArchiveStatePill state={file.archiveState} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(file.createdAt)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={`Actions for ${file.name}`}>
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {archived ? (
                            <DropdownMenuItem
                              disabled={moving}
                              onSelect={() =>
                                void run(() => restoreFile.mutateAsync(file.id), "Restore")
                              }
                            >
                              <RotateCcw className="size-4" />
                              Restore to R2
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              disabled={moving}
                              onSelect={() =>
                                void run(() => archiveFile.mutateAsync(file.id), "Archive")
                              }
                            >
                              <Archive className="size-4" />
                              Archive to Drive
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            onSelect={() => {
                              void run(async () => {
                                const blob = new Blob([`Demo contents of ${file.name}`], {
                                  type: file.mimeType,
                                });
                                const url = URL.createObjectURL(blob);
                                const link = document.createElement("a");
                                link.href = url;
                                link.download = file.name;
                                link.click();
                                URL.revokeObjectURL(url);
                              }, "Download");
                            }}
                          >
                            <Download className="size-4" />
                            Download
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => void run(() => deleteFile.mutateAsync(file.id), "Delete")}
                          >
                            <Trash2 className="size-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload to {activeWorkspace?.name ?? "workspace"}</DialogTitle>
            <DialogDescription>
              Files are stored in active storage (R2). Images and video also appear in the Gallery.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="file-input">Choose files</Label>
              <Input
                id="file-input"
                type="file"
                multiple
                onChange={(event) => setPending(event.target.files)}
              />
            </div>
            {pending && pending.length > 0 ? (
              <ul className="flex flex-col gap-1 rounded-lg border border-border bg-muted/40 p-3 text-xs">
                {Array.from(pending).map((file) => (
                  <li key={file.name} className="flex items-center justify-between gap-2">
                    <span className="truncate">{file.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {formatBytes(file.size)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                No files selected yet. Uploads are real mutations against the active data source.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleUpload()} disabled={busy || !pending?.length}>
              {busy ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
