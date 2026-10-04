/**
 * Capture operational data from this repository into an Octo workspace.
 *
 * Reads git state, repository shape, test inventory, and the live server health,
 * then uploads one JSON snapshot into a target workspace so the data can be
 * browsed, retained, and analyzed alongside other workspace files. Read-only
 * against the repo and the server; the only write is the snapshot upload.
 *
 * Usage:
 *   OCTO_OPS_TOKEN=octo_live_ws_... OCTO_OPS_WORKSPACE=<uuid> npm run capture-ops
 *   ... -- --dry-run     print the snapshot without uploading
 */

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const ROOT = process.cwd();
const BASE_URL = process.env['OCTO_OPS_BASE_URL'] ?? 'http://localhost:3001';
const TOKEN = process.env['OCTO_OPS_TOKEN'];
const WORKSPACE_ID = process.env['OCTO_OPS_WORKSPACE'];
const DRY_RUN = process.argv.includes('--dry-run');

const IGNORED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.venv', 'venv', '__pycache__']);

function sh(command: string): string {
  try {
    return execSync(command, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

interface RepoStats {
  files: number;
  bytes: number;
  byExtension: Record<string, number>;
}

function walk(dir: string, stats: RepoStats): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let info;
    try {
      info = statSync(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      walk(full, stats);
    } else {
      stats.files += 1;
      stats.bytes += info.size;
      const ext = extname(entry).toLowerCase() || '(none)';
      stats.byExtension[ext] = (stats.byExtension[ext] ?? 0) + 1;
    }
  }
}

function countMatches(dir: string, pattern: RegExp): number {
  let total = 0;
  const walkFiles = (d: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORED_DIRS.has(entry)) continue;
      const full = join(d, entry);
      let info;
      try {
        info = statSync(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) walkFiles(full);
      else if (/\.(ts|tsx|py)$/.test(entry)) {
        const text = readFileSync(full, 'utf8');
        total += (text.match(pattern) ?? []).length;
      }
    }
  };
  walkFiles(dir);
  return total;
}

async function gatherHealth(): Promise<unknown> {
  try {
    const response = await fetch(`${BASE_URL}/health`);
    return await response.json();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const repo: RepoStats = { files: 0, bytes: 0, byExtension: {} };
  walk(ROOT, repo);

  const topExtensions = Object.entries(repo.byExtension)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([ext, count]) => ({ ext, count }));

  const snapshot = {
    capturedAt: new Date().toISOString(),
    host: process.env['COMPUTERNAME'] ?? process.env['HOSTNAME'] ?? 'unknown',
    git: {
      branch: sh('git rev-parse --abbrev-ref HEAD'),
      head: sh('git rev-parse --short HEAD'),
      lastCommit: sh('git log -1 --pretty=%s'),
      commitsLast24h: Number(sh('git rev-list --count --since=24.hours HEAD')) || 0,
      uncommittedChanges: sh('git status --short').split('\n').filter(Boolean).length,
    },
    repo: {
      trackedFiles: repo.files,
      totalBytes: repo.bytes,
      topExtensions,
    },
    tests: {
      testFiles: sh('git ls-files "tests/**/*.spec.ts" "tests/**/*.test.ts"').split('\n').filter(Boolean).length,
      testCases: countMatches(join(ROOT, 'tests'), /\b(it|test)\s*\(/g),
    },
    health: await gatherHealth(),
  };

  const body = JSON.stringify(snapshot, null, 2);
  const remoteName = `ops/${snapshot.capturedAt.replace(/[:.]/g, '-')}.json`;

  if (DRY_RUN) {
    console.log(`[dry-run] would upload ${remoteName} (${Buffer.byteLength(body)} bytes)`);
    console.log(body);
    return;
  }

  if (!TOKEN || !WORKSPACE_ID) {
    console.error('OCTO_OPS_TOKEN and OCTO_OPS_WORKSPACE are required (or pass --dry-run).');
    process.exitCode = 1;
    return;
  }

  const response = await fetch(`${BASE_URL}/api/files/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      workspaceId: WORKSPACE_ID,
      name: remoteName,
      mimeType: 'application/json',
      data: body,
      dataEncoding: 'utf8',
    }),
  });

  if (!response.ok) {
    console.error(`Upload failed: ${response.status} ${await response.text()}`);
    process.exitCode = 1;
    return;
  }

  const record = (await response.json()) as { id: string; name: string; sizeBytes: number };
  console.log(JSON.stringify({ uploaded: record.name, id: record.id, sizeBytes: record.sizeBytes, git: snapshot.git, repo: { trackedFiles: repo.files, totalBytes: repo.bytes } }));
}

await main();
