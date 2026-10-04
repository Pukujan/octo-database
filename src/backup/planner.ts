/**
 * Managed backup planner.
 *
 * Pure decision logic for the Desktop/Downloads backup: which local files are
 * eligible, where they land in the target workspace, and whether they changed
 * since the last run. The CLI (`scripts/octo-backup.ts`) supplies filesystem
 * stats and hashes and performs the uploads; keeping the decisions here makes
 * them testable without a network or a real directory walk.
 */

export interface ManifestEntry {
  size: number;
  mtimeMs: number;
  sha256: string;
  remotePath: string;
}

export type Manifest = Record<string, ManifestEntry>;

export interface CurrentFileState {
  size: number;
  mtimeMs: number;
  sha256: string;
}

/** Files that are mid-write or OS cruft are never worth backing up. */
const TEMP_SUFFIXES = ['.crdownload', '.part', '.tmp', '.partial'];
const TEMP_PREFIXES = ['~$'];

/**
 * Returns why a local file should be skipped, or null when it should be backed
 * up. `extraIgnore` is matched against the bare file name.
 */
export function classifyLocalFile(name: string, extraIgnore: string[] = []): 'temp' | 'ignored' | null {
  const lower = name.toLowerCase();
  if (TEMP_PREFIXES.some((prefix) => name.startsWith(prefix))) return 'temp';
  if (TEMP_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return 'temp';
  if (extraIgnore.includes(name)) return 'ignored';
  return null;
}

/**
 * Machine-generated directories that are never worth uploading: build output,
 * VCS metadata, and package caches dominate a real Desktop (a single project tree
 * is often 90% node_modules) and are reproducible rather than backed-up content.
 * `extraIgnore` prunes additional directories by bare name.
 */
const EXCLUDED_DIRS = [
  'node_modules',
  '.git',
  '__pycache__',
  '.venv',
  'venv',
  '.cache',
  '.next',
  '.nuxt',
  '.pytest_cache',
  '.mypy_cache',
  '.tox',
  '.turbo',
];

export function shouldSkipDirectory(name: string, extraIgnore: string[] = []): boolean {
  return EXCLUDED_DIRS.includes(name.toLowerCase()) || extraIgnore.includes(name);
}

/**
 * Size-based eligibility. An empty file is skipped because the upload API
 * rejects a zero-length payload, and anything above the cap is skipped so a first
 * run over a large folder stays bounded.
 */
export function classifySize(size: number, maxBytes: number): 'empty' | 'too-large' | null {
  if (size === 0) return 'empty';
  if (size > maxBytes) return 'too-large';
  return null;
}

/** The workspace-relative path for a local file: `<source>/<relative path>`. */
export function remotePathFor(source: string, relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  return `${source}/${normalized}`;
}

/** True only when the recorded size, mtime, and content hash all still match. */
export function isUnchanged(entry: ManifestEntry | undefined, current: CurrentFileState): boolean {
  if (!entry) return false;
  return (
    entry.size === current.size &&
    entry.mtimeMs === current.mtimeMs &&
    entry.sha256 === current.sha256
  );
}

/**
 * Fast pre-check: a file whose size and mtime match the manifest is treated as
 * unchanged without re-hashing its bytes, so re-runs over large folders do not
 * re-read every file. A differing mtime falls through to the full hash check.
 */
export function sameStat(entry: ManifestEntry | undefined, size: number, mtimeMs: number): boolean {
  if (!entry) return false;
  return entry.size === size && entry.mtimeMs === mtimeMs;
}

/**
 * Splits configured backup sources into the ones that exist on disk and the ones
 * that do not, so a summary can report coverage honestly: a source whose folder
 * is missing or redirected was never read, and must not be listed as backed up.
 */
export function partitionSources<T extends { name: string }>(
  sources: T[],
  exists: (source: T) => boolean
): { scanned: T[]; missing: T[] } {
  const scanned: T[] = [];
  const missing: T[] = [];
  for (const source of sources) (exists(source) ? scanned : missing).push(source);
  return { scanned, missing };
}

/**
 * Existing workspace records a re-upload supersedes, matched by their exact
 * remote path. The workspace has no name uniqueness, so a changed file that is
 * uploaded again would otherwise accumulate a new record per backup run. Returns
 * every matching id so the CLI can delete them after the new version is stored.
 */
export function supersededFileIds(
  remotePath: string,
  existing: { id: string; name: string }[]
): string[] {
  return existing.filter((file) => file.name === remotePath).map((file) => file.id);
}
