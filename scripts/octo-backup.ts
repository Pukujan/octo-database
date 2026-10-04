/**
 * Managed folder backup: Desktop and Downloads -> one Octo workspace.
 *
 * Upload-only. This tool reads local folders and uploads changed files into a
 * single target workspace, foldered by source (`desktop/...`, `downloads/...`).
 * It never deletes, moves, or renames anything locally, and it stores no
 * credentials: the token comes from the environment.
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
import { classifyLocalFile, classifySize, remotePathFor, isUnchanged, sameStat, type Manifest } from '../src/backup/planner';
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

async function main(): Promise<void> {
  const sources = parseSources();
  const manifest = loadManifest();
  const uploads: PlannedUpload[] = [];
  let skippedTemp = 0;
  let skippedIgnored = 0;
  let unchanged = 0;
  let skippedLarge = 0;
  let skippedEmpty = 0;

  for (const source of sources) {
    if (!existsSync(source.dir)) {
      console.error(`Source not found, skipping: ${source.name} (${source.dir})`);
      continue;
    }
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
    sources: sources.map((s) => s.name),
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

  let uploaded = 0;
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
  console.log(JSON.stringify({ mode: 'commit', ...summary, uploaded, manifest: MANIFEST_PATH }, null, 2));
}

await main();
