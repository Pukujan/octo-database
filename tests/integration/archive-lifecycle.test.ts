/**
 * Integration Tests: Archive lifecycle through the worker (Slice 5)
 *
 * Drives `processJob` for `archive_file` / `restore_file` jobs, covering the
 * failure matrix the issue calls out. The properties asserted are the ones that
 * protect the only verified copy:
 *
 *   - the R2 source survives any failure before the canonical transition;
 *   - a reconciliation state is not retried blindly;
 *   - a retry after a partial failure converges instead of duplicating work.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { ObjectStore } from '../../src/storage/object-store';
import { ArchiveStore } from '../../src/storage/google-drive-provider';
import { ArchiveDeps, ArchiveFileRecord, ArchiveState } from '../../src/storage/archive-service';
import { ClaimedJob } from '../../src/jobs/job-service';
import { processJob, WorkerDeps } from '../../src/jobs/worker';

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

class MemoryStore implements ObjectStore {
  readonly label = 'memory';
  readonly objects = new Map<string, Buffer>();
  failGet = false;
  failDelete = false;

  async head(key: string): Promise<number | null> {
    const found = this.objects.get(key);
    return found ? found.byteLength : null;
  }
  async put(key: string, bytes: Buffer): Promise<void> {
    this.objects.set(key, bytes);
  }
  async get(key: string): Promise<Buffer | null> {
    if (this.failGet) throw new Error('active read refused');
    return this.objects.get(key) ?? null;
  }
  async delete(key: string): Promise<void> {
    if (this.failDelete) throw new Error('active delete refused');
    this.objects.delete(key);
  }
}

class MemoryArchive implements ArchiveStore {
  readonly label = 'google_drive';
  readonly objects = new Map<string, { data: Buffer; mimeType: string }>();
  private nextId = 1;
  failPut = false;
  failGet = false;
  corruptOnRead = false;

  async put(
    _name: string,
    bytes: Buffer,
    mimeType: string,
    existingLocator?: string | null
  ): Promise<{ locator: string; sizeBytes: number }> {
    if (this.failPut) throw new Error('drive upload refused');
    const locator = existingLocator ?? `drive-${this.nextId++}`;
    this.objects.set(locator, { data: Buffer.from(bytes), mimeType });
    return { locator, sizeBytes: bytes.byteLength };
  }

  async get(locator: string): Promise<{ data: Buffer; sizeBytes: number; mimeType: string }> {
    if (this.failGet) throw new Error('drive download refused');
    const found = this.objects.get(locator);
    if (!found) throw new Error('drive object missing');
    const data = this.corruptOnRead ? Buffer.from('corrupted') : found.data;
    return { data, sizeBytes: data.byteLength, mimeType: found.mimeType };
  }

  async delete(locator: string): Promise<void> {
    this.objects.delete(locator);
  }

  async exists(locator: string): Promise<boolean> {
    return this.objects.has(locator);
  }
}

interface Harness {
  active: MemoryStore;
  archive: MemoryArchive;
  record: ArchiveFileRecord;
  deps: WorkerDeps;
  lastState: () => ArchiveState;
}

function makeHarness(
  options: {
    archiveState?: ArchiveState;
    failCanonicalUpdate?: boolean;
    /** When false the active tier starts empty (a pruned archived file). */
    seedActive?: boolean;
    coldLocator?: string;
  } = {}
): Harness {
  const active = new MemoryStore();
  const archive = new MemoryArchive();

  const activeBytes = Buffer.from('the original bytes');
  const storageKey = 'workspaces/ws-1/f-1/photo.png';
  if (options.seedActive !== false) active.objects.set(storageKey, activeBytes);

  let state: ArchiveState = options.archiveState ?? 'active_r2';
  if (options.coldLocator) {
    archive.objects.set(options.coldLocator, { data: activeBytes, mimeType: 'image/png' });
  }

  const record: ArchiveFileRecord = {
    fileId: 'f-1',
    workspaceId: 'ws-1',
    name: 'photo.png',
    mimeType: 'image/png',
    storageKey,
    archiveState: state,
    archiveLocator: options.coldLocator ?? null,
    archiveHash: options.coldLocator ? sha256(activeBytes) : null,
  };

  const archiveDeps: ArchiveDeps = {
    active,
    archive,
    updateFile: async (_fileId, patch) => {
      // Models the canonical transition failing after the verified copy exists;
      // the intent write and the reconciliation write still succeed.
      if (options.failCanonicalUpdate && patch.archiveState === 'archived_drive') {
        throw new Error('state update refused');
      }
      if (patch.archiveState) state = patch.archiveState;
      if (patch.archiveLocator !== undefined) record.archiveLocator = patch.archiveLocator;
      if (patch.archiveHash !== undefined) record.archiveHash = patch.archiveHash;
    },
  };

  const deps: WorkerDeps = {
    claim: async () => null,
    store: active,
    complete: async () => {},
    fail: async () => {},
    activity: async () => {},
    archive: archiveDeps,
    loadArchiveTarget: async () => ({ ...record, archiveState: state }),
  };

  return { active, archive, record, deps, lastState: () => state };
}

function job(jobType: string): ClaimedJob {
  return {
    jobId: 'job-1',
    workspaceId: 'ws-1',
    jobType,
    attempt: 1,
    payload: { fileId: 'f-1' },
  };
}

describe('archive_file job', () => {
  it('archives the file and prunes the active copy', async () => {
    const h = makeHarness();

    const outcome = await processJob(job('archive_file'), h.deps);

    expect(outcome.status).toBe('completed');
    expect(h.active.objects.size).toBe(0);
    expect(h.archive.objects.size).toBe(1);
    expect(h.lastState()).toBe('archived_drive');
  });

  it('fails permanently when archival is not configured', async () => {
    const h = makeHarness();
    const deps: WorkerDeps = { ...h.deps, archive: undefined, loadArchiveTarget: undefined };

    const outcome = await processJob(job('archive_file'), deps);

    expect(outcome.status).toBe('failed');
    expect(outcome.detail).toMatch(/not configured/);
  });

  it('completes as a no-op when the target file was deleted before the job ran', async () => {
    const h = makeHarness();
    const deps: WorkerDeps = { ...h.deps, loadArchiveTarget: async () => null };

    const outcome = await processJob(job('archive_file'), deps);

    // A deleted file makes the requested transition moot. Failing the job
    // permanently would strand an unclearable error in the workspace, so the
    // job resolves as a benign no-op instead.
    expect(outcome.status).toBe('completed');
    expect(outcome.detail).toMatch(/no longer exists/);
    // Nothing was copied or pruned: there is no file to act on.
    expect(h.active.objects.size).toBe(1);
    expect(h.archive.objects.size).toBe(0);
  });

  it('keeps the source and is retryable when the R2 read fails', async () => {
    const h = makeHarness();
    h.active.failGet = true;

    const outcome = await processJob(job('archive_file'), h.deps);

    // No copy was made, so a retry can still succeed.
    expect(outcome.status).toBe('retry');
    expect(h.active.objects.size).toBe(1);
    expect(h.archive.objects.size).toBe(0);
  });

  it('keeps the source and is retryable when the Drive upload fails', async () => {
    const h = makeHarness();
    h.archive.failPut = true;

    const outcome = await processJob(job('archive_file'), h.deps);

    expect(outcome.status).toBe('retry');
    expect(h.active.objects.size).toBe(1);
    expect(h.lastState()).toBe('active_r2');
  });

  it('requires reconciliation (no blind retry) when verification fails', async () => {
    const h = makeHarness();
    h.archive.corruptOnRead = true;

    const outcome = await processJob(job('archive_file'), h.deps);

    // The bytes are safe in both tiers; retrying immediately would not help.
    expect(outcome.status).toBe('failed');
    expect(h.lastState()).toBe('reconciliation_required');
    expect(h.active.objects.size).toBe(1);
    expect(h.archive.objects.size).toBe(1);
  });

  it('requires reconciliation when the canonical state update fails', async () => {
    const h = makeHarness({ failCanonicalUpdate: true });

    const outcome = await processJob(job('archive_file'), h.deps);

    expect(outcome.status).toBe('failed');
    expect(h.lastState()).toBe('reconciliation_required');
    expect(h.active.objects.size).toBe(1);
    expect(h.archive.objects.size).toBe(1);
  });

  it('completes even when the active prune fails, reporting it plainly', async () => {
    const h = makeHarness();
    h.active.failDelete = true;

    const outcome = await processJob(job('archive_file'), h.deps);

    // The archive succeeded; the lingering copy is a benign duplicate.
    expect(outcome.status).toBe('completed');
    expect(outcome.detail).toMatch(/prune pending/);
    expect(h.lastState()).toBe('archived_drive');
  });

  it('converges on a retry after a successful archive', async () => {
    const h = makeHarness();
    await processJob(job('archive_file'), h.deps);
    const locator = Array.from(h.archive.objects.keys())[0]!;

    // A retry sees the file already archived with an intact cold copy.
    const retry = await processJob(job('archive_file'), h.deps);

    expect(retry.status).toBe('completed');
    expect(h.archive.objects.size).toBe(1);
    expect(h.archive.objects.has(locator)).toBe(true);
  });
});

describe('restore_file job', () => {
  it('restores the bytes and leaves the cold copy in place', async () => {
    const h = makeHarness({ archiveState: 'archived_drive', coldLocator: 'drive-9', seedActive: false });

    const outcome = await processJob(job('restore_file'), h.deps);

    expect(outcome.status).toBe('completed');
    expect(h.active.objects.get('workspaces/ws-1/f-1/photo.png')).toBeTruthy();
    expect(h.archive.objects.has('drive-9')).toBe(true);
    expect(h.lastState()).toBe('active_r2');
  });

  it('is a no-op for an already-active file', async () => {
    const h = makeHarness();

    const outcome = await processJob(job('restore_file'), h.deps);

    expect(outcome.status).toBe('completed');
    expect(h.lastState()).toBe('active_r2');
  });

  it('keeps the file archived and is retryable when the cold read fails', async () => {
    const h = makeHarness({ archiveState: 'archived_drive', coldLocator: 'drive-9', seedActive: false });
    h.archive.failGet = true;

    const outcome = await processJob(job('restore_file'), h.deps);

    expect(outcome.status).toBe('retry');
    expect(h.lastState()).toBe('archived_drive');
  });

  it('completes as a no-op when the target file was deleted before the job ran', async () => {
    const h = makeHarness({ archiveState: 'archived_drive', coldLocator: 'drive-9', seedActive: false });
    const deps: WorkerDeps = { ...h.deps, loadArchiveTarget: async () => null };

    const outcome = await processJob(job('restore_file'), deps);

    expect(outcome.status).toBe('completed');
    expect(outcome.detail).toMatch(/no longer exists/);
    // The deleted file's cold copy is untouched; there is nothing to restore.
    expect(h.archive.objects.has('drive-9')).toBe(true);
    expect(h.active.objects.size).toBe(0);
  });

  it('requires reconciliation when the cold copy hash does not match', async () => {
    const h = makeHarness({ archiveState: 'archived_drive', coldLocator: 'drive-9', seedActive: false });
    h.archive.objects.set('drive-9', { data: Buffer.from('tampered'), mimeType: 'image/png' });

    const outcome = await processJob(job('restore_file'), h.deps);

    expect(outcome.status).toBe('failed');
    expect(h.lastState()).toBe('reconciliation_required');
    // The tampered bytes must not land in the active tier.
    expect(h.active.objects.size).toBe(0);
  });
});
