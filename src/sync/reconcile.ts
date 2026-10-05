/**
 * Project-sync reconciliation planner.
 *
 * Pure decision logic for `octo-sync`: given what the local project directory
 * holds, what the workspace holds, and the baseline of what was last exchanged,
 * classify every path and say what a push or a pull should do. No filesystem and
 * no network, so the three-way logic is testable in isolation (mirroring
 * `src/backup/planner.ts`).
 *
 * The workspace is canonical and the local tree is a partial working set, so
 * absence on either side is NEVER read as a deletion: a local file that is gone
 * means "not checked out here", not "delete the cloud copy", and a missing
 * remote record is reported, not applied locally. Delete and rename propagation
 * are deliberately out of scope.
 */

/** What the last successful exchange recorded for one workspace-relative path. */
export interface SyncBaselineEntry {
  sha256: string;
  size: number;
  mtimeMs: number;
  remoteId: string;
  /** Record ids this client superseded but has not yet deleted (interrupted replace). */
  pendingDelete?: string[];
}

export interface SyncState {
  version: 1;
  baseUrl: string;
  workspaceId: string;
  entries: Record<string, SyncBaselineEntry>;
}

export interface RemoteRecord {
  id: string;
  name: string;
  sizeBytes: number;
  archiveState?: string;
}

export interface LocalFile {
  /** Workspace-relative path with forward slashes. */
  path: string;
  size: number;
  mtimeMs: number;
  sha256: string;
}

export type PathCategory =
  | 'in-sync'
  | 'local-changed'
  | 'remote-changed'
  | 'both-changed'
  | 'local-only'
  | 'remote-only'
  | 'local-absent'
  | 'remote-removed'
  | 'untracked-both'
  | 'ambiguous';

export interface ClassifiedPath {
  path: string;
  category: PathCategory;
  local?: LocalFile;
  baseline?: SyncBaselineEntry;
  /** All remote record ids at this path (more than one means a duplicate). */
  remoteIds: string[];
}

export interface ReconcileInput {
  baseline: Record<string, SyncBaselineEntry>;
  local: LocalFile[];
  remote: RemoteRecord[];
}

/** Remote record ids grouped by their workspace-relative name. */
export function groupRemoteByName(records: RemoteRecord[]): Map<string, string[]> {
  const byName = new Map<string, string[]>();
  for (const record of records) {
    const ids = byName.get(record.name);
    if (ids) ids.push(record.id);
    else byName.set(record.name, [record.id]);
  }
  return byName;
}

/**
 * Classify a single path. `remoteIds` is the full set of remote record ids at
 * that path: more than one is a duplicate the client refuses to resolve on its
 * own, because the listing order is not a contract and picking a "newest" could
 * discard another writer's record.
 */
export function classifyPath(
  baseline: SyncBaselineEntry | undefined,
  local: LocalFile | undefined,
  remoteIds: string[]
): PathCategory {
  if (remoteIds.length > 1) return 'ambiguous';
  const remoteId = remoteIds[0];
  const remotePresent = remoteId !== undefined;

  if (!baseline) {
    if (local && remotePresent) return 'untracked-both';
    if (local) return 'local-only';
    if (remotePresent) return 'remote-only';
    return 'in-sync';
  }

  const localChanged = local !== undefined && local.sha256 !== baseline.sha256;
  const localGone = local === undefined;
  const remoteChanged = remotePresent && remoteId !== baseline.remoteId;
  const remoteGone = !remotePresent;

  if (localGone && remoteGone) return 'in-sync';
  if (localGone) return remoteChanged ? 'both-changed' : 'local-absent';
  if (remoteGone) return localChanged ? 'both-changed' : 'remote-removed';
  if (localChanged && remoteChanged) return 'both-changed';
  if (localChanged) return 'local-changed';
  if (remoteChanged) return 'remote-changed';
  return 'in-sync';
}

/** Classify every path known to any of the three sides. */
export function reconcile(input: ReconcileInput): ClassifiedPath[] {
  const remoteByName = groupRemoteByName(input.remote);
  const localByPath = new Map(input.local.map((file) => [file.path, file]));
  const paths = new Set<string>([
    ...Object.keys(input.baseline),
    ...Array.from(localByPath.keys()),
    ...Array.from(remoteByName.keys()),
  ]);

  const classified: ClassifiedPath[] = [];
  for (const path of Array.from(paths).sort()) {
    classified.push({
      path,
      category: classifyPath(input.baseline[path], localByPath.get(path), remoteByName.get(path) ?? []),
      ...(localByPath.get(path) === undefined ? {} : { local: localByPath.get(path) as LocalFile }),
      ...(input.baseline[path] === undefined ? {} : { baseline: input.baseline[path] as SyncBaselineEntry }),
      remoteIds: remoteByName.get(path) ?? [],
    });
  }
  return classified;
}

/** Paths a push should upload: local work that is new or changed. */
export function pathsToPush(paths: ClassifiedPath[]): ClassifiedPath[] {
  return paths.filter((p) => p.category === 'local-changed' || p.category === 'local-only');
}

/** Paths a pull should download: remote work that is new or changed. */
export function pathsToPull(paths: ClassifiedPath[]): ClassifiedPath[] {
  return paths.filter((p) => p.category === 'remote-changed' || p.category === 'remote-only');
}

/**
 * Record ids a push must delete after uploading the replacement record, so a
 * path ends with exactly one record.
 *
 * A normal push supersedes only ids this client already exchanged (its baseline
 * remote id plus any replace it failed to finish). A forced overwrite of
 * `both-changed` / `untracked-both` also removes the single current remote record
 * observed at the path — otherwise the upload would leave two records and the
 * next run would report `ambiguous`. This stays a targeted delete, not a
 * same-name sweep: only the exact id the reconciliation read returned. A path
 * with more than one remote id is never forced (see `classifyPath`), so the
 * `length === 1` guard is a belt-and-braces check, not the primary refusal.
 */
export function recordIdsToSupersede(
  path: ClassifiedPath,
  uploadedId: string,
  force: boolean
): string[] {
  const ids = new Set<string>(path.baseline?.pendingDelete ?? []);
  if (path.baseline) ids.add(path.baseline.remoteId);
  if (force && path.remoteIds.length === 1) ids.add(path.remoteIds[0] as string);
  ids.delete(uploadedId);
  return Array.from(ids);
}

/**
 * Reject a workspace-relative path that would escape the project root when
 * joined locally. Remote names are attacker-influenced in the general case, so
 * an absolute path, a drive letter, or a `..` segment is refused before any
 * write rather than trusted.
 */
export function isSafeRelativePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.startsWith('\\')) return false;
  if (/^[a-zA-Z]:/.test(path)) return false;
  const segments = path.split(/[\\/]/);
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** Normalize a local relative path to the forward-slash form used remotely. */
export function toRemotePath(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * Filter a classified set down to the named paths, if any were named. A named
 * path that is not present is reported by the caller, not silently ignored.
 */
export function selectPaths(paths: ClassifiedPath[], selected: string[]): ClassifiedPath[] {
  if (selected.length === 0) return paths;
  const wanted = new Set(selected.map(toRemotePath));
  return paths.filter((p) => wanted.has(p.path));
}
