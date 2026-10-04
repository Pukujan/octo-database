/**
 * Managed folder backup: Desktop and Downloads -> one Octo workspace.
 *
 * This tool reads local folders and uploads changed files into a single target
 * workspace, foldered by source (`desktop/...`, `downloads/...`). It never
 * deletes, moves, or renames anything locally, and it stores no credentials: the
 * token comes from the environment.
 *
 * Replace-on-change: the workspace has no name uniqueness, so re-uploading a
 * changed file would otherwise leave its prior record behind and pile up one
 * copy per run. After storing the new version, the CLI deletes the prior records
 * whose remote path matches, so a backed-up path always has exactly one current
 * copy. This needs a token with the `delete` scope (plus `read`, `write`,
 * `files`); without it the uploads still succeed but prior versions are left in
 * place and reported as `replaceFailed`.
 *
 * Incremental: a local manifest records path, size, mtime, and SHA-256 per file;
 * unchanged files are skipped, so re-runs upload only what changed.
 *
 * Usage:
 *   OCTO_BACKUP_TOKEN=octo_live_ws_... OCTO_BACKUP_WORKSPACE=<uuid> \
 *     npm run backup -- --dry-run
 *   OCTO_BACKUP_TOKEN=... OCTO_BACKUP_WORKSPACE=<uuid> npm run backup -- --commit
 *
 * Env:
 *   OCTO_BACKUP_BASE_URL   default http://localhost:3001
 *   OCTO_BACKUP_SOURCES    default "Desktop=$HOME/Desktop,Downloads=$HOME/Downloads"
 *   OCTO_BACKUP_IGNORE     comma-separated bare file names to skip
 *   OCTO_BACKUP_MANIFEST   default $HOME/.octo/backup-manifest.json
 *   OCTO_BACKUP_MAX_MB     skip files larger than this (default 100)
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { classifyLocalFile, classifySize, remotePathFor, isUnchanged, partitionSources, sameStat, supersededFileIds, type Manifest } from '../src/backup/planner';
import { walkFiles } from '../src/backup/walk';

const BASE_URL = process.env['OCTO_BACKUP_BASE_URL'] ?? 'http://localhost:3001';
const TOKEN = process.env['OCTO_BACKUP_TOKEN'];
const WORKSPACE_ID = process.env['OCTO_BACKUP_WORKSPACE'];
const MANIFEST_PATH =
  process.env['OCTO_BACKUP_MANIFEST'] ?? join(homedir(), '.octo', 'backup-manifest.json');
const MAX_BYTES = (Number(process.env['OCTO_BACKUP_MAX_MB']) || 100) * 1024 * 1024;
const IGNORE = (process.env['OCTO_BACKUP_IGNORE'] ?? '.DS_Store,Thumbs.db,desktop.ini')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const DRY_RUN = process.argv.includes('--dry-run');
const COMMIT = process.argv.includes('--commit');

interface Source {
  name: string;
  dir: string;
}

function parseSources(): Source[] {
  const spec =
    process.env['OCTO_BACKUP_SOURCES'] ??
    `Desktop=${join(homedir(), 'Desktop')},Downloads=${join(homedir(), 'Downloads')}`;
  return spec
    .split(',')
    .map((pair) => {
      const [name, dir] = pair.split('=');
      return { name: (name ?? '').trim().toLowerCase(), dir: (dir ?? '').trim() };
    })
    .filter((source) => source.name && source.dir);
}

function loadManifest(): Manifest {
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
  } catch {
    return {};
  }
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

interface PlannedUpload {
  source: string;
  relPath: string;
  absolutePath: string;
  remotePath: string;
  size: number;
  mtimeMs: number;
  sha256: string;
}

async function listExistingFiles(): Promise<{ id: string; name: string }[]> {
  const response = await fetch(
    `${BASE_URL}/api/files?workspaceId=${encodeURIComponent(WORKSPACE_ID as string)}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );
  if (!response.ok) {
    console.error(
      `Could not list existing files (${response.status}); prior versions will not be replaced.`
    );
    return [];
  }
  return (await response.json()) as { id: string; name: string }[];
}

async function deleteFile(id: string): Promise<boolean> {
  const response = await fetch(
    `${BASE_URL}/api/files/${encodeURIComponent(id)}?workspaceId=${encodeURIComponent(WORKSPACE_ID as string)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${TOKEN}` } }
  );
  if (!response.ok) {
    console.error(`FAILED to replace prior version ${id}: ${response.status} ${await response.text()}`);
    return false;
  }
  return true;
}

async function main(): Promise<void> {
  const sources = parseSources();
  const manifest = loadManifest();
  const uploads: PlannedUpload[] = [];
  let skippedTemp = 0;
  let skippedIgnored = 0;
  let unchanged = 0;
  let skippedLarge = 0;
  let skippedEmpty = 0;

  const { scanned, missing } = partitionSources(sources, (source) => existsSync(source.dir));
  for (const source of missing) {
    console.error(`Source not found, skipping: ${source.name} (${source.dir})`);
  }

  for (const source of scanned) {
    walkFiles(source.dir, (absolutePath, relPath) => {
      const base = relPath.split(/[\\/]/).pop() ?? relPath;
      const reason = classifyLocalFile(base, IGNORE);
      if (reason === 'temp') {
        skippedTemp += 1;
        return;
      }
      if (reason === 'ignored') {
        skippedIgnored += 1;
        return;
      }
      const info = statSync(absolutePath);
      const sizeReason = classifySize(info.size, MAX_BYTES);
      if (sizeReason === 'empty') {
        skippedEmpty += 1;
        return;
      }
      if (sizeReason === 'too-large') {
        skippedLarge += 1;
        return;
      }
      // Fast path: same size and mtime as last time means we trust the manifest
      // without re-reading the bytes.
      if (sameStat(manifest[absolutePath], info.size, info.mtimeMs)) {
        unchanged += 1;
        return;
      }
      const sha256 = sha256File(absolutePath);
      const current = { size: info.size, mtimeMs: info.mtimeMs, sha256 };
      if (isUnchanged(manifest[absolutePath], current)) {
        unchanged += 1;
        return;
      }
      uploads.push({
        source: source.name,
        relPath,
        absolutePath,
        remotePath: remotePathFor(source.name, relPath),
        ...current,
      });
    }, IGNORE);
  }

  const totalBytes = uploads.reduce((sum, upload) => sum + upload.size, 0);
  const summary = {
    sources: scanned.map((s) => s.name),
    missingSources: missing.map((s) => s.name),
    toUpload: uploads.length,
    totalBytes,
    unchanged,
    skippedTemp,
    skippedIgnored,
    skippedLarge,
    skippedEmpty,
  };

  if (DRY_RUN || !COMMIT) {
    console.log(JSON.stringify({ mode: DRY_RUN ? 'dry-run' : 'plan (pass --commit to upload)', ...summary }, null, 2));
    for (const upload of uploads.slice(0, 20)) {
      console.log(`  ${upload.remotePath} (${upload.size} bytes)`);
    }
    if (uploads.length > 20) console.log(`  ...and ${uploads.length - 20} more`);
    if (!DRY_RUN && !COMMIT) console.log('Re-run with --commit to upload.');
    return;
  }

  if (!TOKEN || !WORKSPACE_ID) {
    console.error('OCTO_BACKUP_TOKEN and OCTO_BACKUP_WORKSPACE are required to upload.');
    process.exitCode = 1;
    return;
  }

  const existing = await listExistingFiles();
  let uploaded = 0;
  let replaced = 0;
  let replaceFailed = 0;
  for (const upload of uploads) {
    const data = readFileSync(upload.absolutePath).toString('base64');
    const response = await fetch(`${BASE_URL}/api/files/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        workspaceId: WORKSPACE_ID,
        name: upload.remotePath,
        mimeType: 'application/octet-stream',
        data,
        dataEncoding: 'base64',
      }),
    });
    if (!response.ok) {
      console.error(`FAILED ${upload.remotePath}: ${response.status} ${await response.text()}`);
      continue;
    }
    // A changed file must replace its prior version rather than accumulate a
    // second record: the workspace has no name uniqueness, so without this every
    // backup run that touches a file leaves the old copy behind. Delete only
    // after the new version is stored, so the workspace is never left without a
    // copy. Matching by exact remote path also clears duplicates from past runs.
    for (const id of supersededFileIds(upload.remotePath, existing)) {
      if (await deleteFile(id)) replaced += 1;
      else replaceFailed += 1;
    }
    manifest[upload.absolutePath] = {
      size: upload.size,
      mtimeMs: upload.mtimeMs,
      sha256: upload.sha256,
      remotePath: upload.remotePath,
    };
    uploaded += 1;
  }

  mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(
    JSON.stringify(
      { mode: 'commit', ...summary, uploaded, replaced, replaceFailed, manifest: MANIFEST_PATH },
      null,
      2
    )
  );
}

await main();
