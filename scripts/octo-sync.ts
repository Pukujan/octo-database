/**
 * Project sync: one local project directory <-> one Octo workspace.
 *
 * Explicit, on-demand reconciliation — no daemon, no watching, no continuous
 * sync. Three commands:
 *   status [path...]   read-only; classify every path against the baseline
 *   push   [path...]   upload local new/changed files
 *   pull   [path...]   download remote new/changed files
 *
 * The workspace is canonical and the local tree is a partial working set, so
 * neither command ever deletes the other side: a local file that is absent means
 * "not checked out here", not "delete the cloud copy". Conflicts (both sides
 * changed) are reported and refused unless `--force` names a direction. Delete
 * and rename propagation are out of scope.
 *
 * Configuration: `.octo/config.json` (committed) carries `{ baseUrl,
 * workspaceId }`; the token is env-only and never written to disk. The baseline
 * lives in `.octo/state.json` (machine-local, gitignore it). The state file is
 * bound to baseUrl+workspaceId: pointing it at a different workspace is refused
 * rather than mis-applied.
 *
 * Usage:
 *   OCTO_TOKEN=octo_live_ws_... npm run sync -- status
 *   OCTO_TOKEN=... npm run sync -- push
 *   OCTO_TOKEN=... npm run sync -- pull docs/readme.md
 *
 * Env:
 *   OCTO_TOKEN          required; an Octo API key (fallback OCTO_MCP_TOKEN)
 *   OCTO_BASE_URL       default http://localhost:3001 (fallback OCTO_MCP_BASE_URL)
 *   OCTO_WORKSPACE_ID   target workspace (or .octo/config.json)
 *   OCTO_SYNC_DIR       project root (default: cwd)
 *   OCTO_SYNC_MAX_MB    skip files larger than this (default 100)
 *   OCTO_SYNC_IGNORE    comma-separated bare file names to skip
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { classifyLocalFile, classifySize } from '../src/backup/planner';
import { walkFiles } from '../src/backup/walk';
import { OctoApi } from '../src/mcp/client';
import {
  isSafeRelativePath,
  reconcile,
  selectPaths,
  toRemotePath,
  type ClassifiedPath,
  type LocalFile,
  type PathCategory,
  type RemoteRecord,
  type SyncState,
} from '../src/sync/reconcile';

const COMMANDS = ['status', 'push', 'pull'] as const;
type Command = (typeof COMMANDS)[number];

const argv = process.argv.slice(2);
const command = argv[0] as Command | undefined;
const args = argv.slice(1);
const flags = new Map<string, string | true>();
const selected: string[] = [];
for (const arg of args) {
  if (!arg.startsWith('--')) {
    selected.push(toRemotePath(arg));
    continue;
  }
  const eq = arg.indexOf('=');
  if (eq === -1) flags.set(arg.slice(2), true);
  else flags.set(arg.slice(2, eq), arg.slice(eq + 1));
}
const has = (name: string) => flags.has(name);
const flagValue = (name: string): string | undefined => {
  const value = flags.get(name);
  return typeof value === 'string' ? value : undefined;
};

const FORCE = has('force');
const JSON_OUT = has('json');

const ROOT = resolve(flagValue('dir') ?? process.env['OCTO_SYNC_DIR'] ?? process.cwd());
const CONFIG_PATH = join(ROOT, '.octo', 'config.json');
const STATE_PATH = join(ROOT, '.octo', 'state.json');
const MAX_BYTES = (Number(flagValue('max-mb') ?? process.env['OCTO_SYNC_MAX_MB']) || 100) * 1024 * 1024;
const IGNORE = (flagValue('ignore') ?? process.env['OCTO_SYNC_IGNORE'] ?? '.DS_Store,Thumbs.db,desktop.ini')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
// `.octo` holds this tool's own config/state and is never transferred.
const IGNORE_DIRS = [...IGNORE, '.octo'];

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

function loadJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function sha256Bytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

interface Config {
  baseUrl?: string;
  workspaceId?: string;
}

interface ScanResult {
  files: LocalFile[];
  skippedEmpty: string[];
  skippedLarge: string[];
  skippedIgnored: number;
}

function scanLocal(state: SyncState): ScanResult {
  const files: LocalFile[] = [];
  const skippedEmpty: string[] = [];
  const skippedLarge: string[] = [];
  let skippedIgnored = 0;

  walkFiles(
    ROOT,
    (absolutePath, relPath) => {
      const base = relPath.split(/[\\/]/).pop() ?? relPath;
      if (classifyLocalFile(base, IGNORE) !== null) {
        skippedIgnored += 1;
        return;
      }
      const path = toRemotePath(relPath);
      if (!isSafeRelativePath(path)) return;
      const info = statSync(absolutePath);
      const sizeReason = classifySize(info.size, MAX_BYTES);
      if (sizeReason === 'empty') {
        skippedEmpty.push(path);
        return;
      }
      if (sizeReason === 'too-large') {
        skippedLarge.push(path);
        return;
      }
      // Fast path: an unchanged size+mtime reuses the recorded hash instead of
      // re-reading every file; a differing stat falls through to a real hash.
      const entry = state.entries[path];
      const sha256 =
        entry && entry.size === info.size && entry.mtimeMs === info.mtimeMs
          ? entry.sha256
          : sha256File(absolutePath);
      files.push({ path, size: info.size, mtimeMs: info.mtimeMs, sha256 });
    },
    IGNORE_DIRS
  );

  return { files, skippedEmpty, skippedLarge, skippedIgnored };
}

function countByCategory(paths: ClassifiedPath[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of paths) counts[p.category] = (counts[p.category] ?? 0) + 1;
  return counts;
}

function report(paths: ClassifiedPath[], extra: Record<string, unknown>): void {
  const counts = countByCategory(paths);
  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          ...extra,
          counts,
          paths: paths
            .filter((p) => p.category !== 'in-sync')
            .map((p) => ({ path: p.path, category: p.category })),
        },
        null,
        2
      )
    );
    return;
  }
  console.log(JSON.stringify(extra, null, 2));
  console.log('categories:', JSON.stringify(counts));
  const notable = paths.filter((p) => p.category !== 'in-sync');
  for (const p of notable.slice(0, 40)) console.log(`  [${p.category}] ${p.path}`);
  if (notable.length > 40) console.log(`  ...and ${notable.length - 40} more`);
}

async function main(): Promise<void> {
  if (!command || !COMMANDS.includes(command)) {
    die(`Usage: octo-sync <${COMMANDS.join('|')}> [path...] [--force] [--json]`);
  }

  const config = loadJson<Config>(CONFIG_PATH) ?? {};
  const baseUrl =
    flagValue('base-url') ??
    process.env['OCTO_BASE_URL'] ??
    process.env['OCTO_MCP_BASE_URL'] ??
    config.baseUrl ??
    'http://localhost:3001';
  const workspaceId =
    flagValue('workspace') ?? process.env['OCTO_WORKSPACE_ID'] ?? config.workspaceId;
  const token = process.env['OCTO_TOKEN'] ?? process.env['OCTO_MCP_TOKEN'];

  if (!workspaceId) die('No workspace: set OCTO_WORKSPACE_ID or .octo/config.json { workspaceId }.');
  if (!token) die('OCTO_TOKEN is required (an Octo API key). The token is never read from disk.');

  const loaded = loadJson<SyncState>(STATE_PATH);
  if (loaded && (loaded.baseUrl !== baseUrl || loaded.workspaceId !== workspaceId)) {
    die(
      `Refusing to run: .octo/state.json is bound to ${loaded.baseUrl} / ${loaded.workspaceId}, ` +
        `but the configured target is ${baseUrl} / ${workspaceId}. Delete .octo/state.json to re-baseline.`
    );
  }
  const state: SyncState = loaded ?? { version: 1, baseUrl, workspaceId, entries: {} };

  const api = new OctoApi({ baseUrl, token });
  const remote = (await api.listFiles(workspaceId)) as RemoteRecord[];
  const scan = scanLocal(state);
  const all = reconcile({ baseline: state.entries, local: scan.files, remote });
  const paths = selectPaths(all, selected);
  if (selected.length > 0) {
    const found = new Set(paths.map((p) => p.path));
    for (const want of selected) if (!found.has(want)) console.error(`Named path not found: ${want}`);
  }

  const extra = {
    root: ROOT,
    workspaceId,
    scanned: scan.files.length,
    skippedIgnored: scan.skippedIgnored,
    skippedEmpty: scan.skippedEmpty.length,
    skippedLarge: scan.skippedLarge.length,
    remoteRecords: remote.length,
  };

  if (command === 'status') {
    report(paths, { mode: 'status', ...extra });
    return;
  }

  if (command === 'push') {
    const candidates = paths.filter(
      (p) =>
        p.category === 'local-changed' ||
        p.category === 'local-only' ||
        (FORCE && (p.category === 'both-changed' || p.category === 'untracked-both'))
    );
    const conflicts = paths.filter(
      (p) => p.category === 'both-changed' && !FORCE
    );
    let uploaded = 0;
    let replaceFailed = 0;
    for (const p of candidates) {
      if (!p.local) continue;
      const bytes = readFileSync(join(ROOT, p.path));
      const record = (await api.uploadFile({
        workspaceId,
        name: p.path,
        data: bytes.toString('base64'),
        mimeType: 'application/octet-stream',
      })) as { id: string };
      // Delete only the exact ids this client last exchanged or already
      // superseded — never a broad same-name sweep that could remove another
      // writer's record.
      const priorIds = Array.from(
        new Set([...(p.baseline?.pendingDelete ?? []), ...(p.baseline ? [p.baseline.remoteId] : [])])
      ).filter((id) => id !== record.id);
      const stillPending: string[] = [];
      for (const id of priorIds) {
        try {
          await api.deleteFile({ workspaceId, fileId: id });
        } catch {
          stillPending.push(id);
          replaceFailed += 1;
        }
      }
      state.entries[p.path] = {
        sha256: p.local.sha256,
        size: p.local.size,
        mtimeMs: p.local.mtimeMs,
        remoteId: record.id,
        ...(stillPending.length ? { pendingDelete: stillPending } : {}),
      };
      mkdirSync(dirname(STATE_PATH), { recursive: true });
      writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
      uploaded += 1;
    }
    report(paths, {
      mode: 'push',
      ...extra,
      uploaded,
      replaceFailed,
      conflicts: conflicts.map((p) => p.path),
      note: conflicts.length
        ? 'Both sides changed on the paths listed under conflicts; re-run with --force to overwrite remote.'
        : undefined,
    });
    return;
  }

  // pull
  const candidates = paths.filter(
    (p) =>
      p.category === 'remote-changed' ||
      p.category === 'remote-only' ||
      (FORCE && (p.category === 'both-changed' || p.category === 'untracked-both'))
  );
  const conflicts = paths.filter((p) => p.category === 'both-changed' && !FORCE);
  let downloaded = 0;
  for (const p of candidates) {
    if (p.remoteIds.length !== 1) continue;
    if (!isSafeRelativePath(p.path)) {
      console.error(`Refusing unsafe remote name: ${p.path}`);
      continue;
    }
    const remoteId = p.remoteIds[0] as string;
    const bytes = Buffer.from(await api.downloadFile({ workspaceId, fileId: remoteId }), 'base64');
    const target = join(ROOT, p.path);
    mkdirSync(dirname(target), { recursive: true });
    const tmp = `${target}.octo-tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, target);
    const info = statSync(target);
    state.entries[p.path] = {
      sha256: sha256Bytes(bytes),
      size: bytes.byteLength,
      mtimeMs: info.mtimeMs,
      remoteId,
    };
    mkdirSync(dirname(STATE_PATH), { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
    downloaded += 1;
  }
  report(paths, {
    mode: 'pull',
    ...extra,
    downloaded,
    conflicts: conflicts.map((p) => p.path),
    note: conflicts.length
      ? 'Both sides changed on the paths listed under conflicts; re-run with --force to overwrite local.'
      : undefined,
  });
}

await main();
