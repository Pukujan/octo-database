/**
 * Unit Tests: Archive lifecycle ordering (Slice 5)
 *
 * The invariant under test is the ordering, not the happy path: bytes are
 * copied, the destination is verified, canonical state is persisted, and only
 * then is the source removed. When any step fails after the copy, both copies
 * must survive and the file must be marked for reconciliation rather than
 * guessed at.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { ObjectStore } from '../../src/storage/object-store';
import { ArchiveStore } from '../../src/storage/google-drive-provider';
import {
  ArchiveDeps,
  ArchiveFileRecord,
  ArchiveTransition,
  archiveFile,
  restoreFile,
} from '../../src/storage/archive-service';

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

class MemoryStore implements ObjectStore {
  readonly label = 'memory';
  readonly objects = new Map<string, Buffer>();
  failDelete = false;

  async head(key: string): Promise<number | null> {
    const found = this.objects.get(key);
    return found ? found.byteLength : null;
  }
  async put(key: string, bytes: Buffer): Promise<void> {
    this.objects.set(key, bytes);
  }
  async get(key: string): Promise<Buffer | null> {
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

  /** Flip to corrupt the bytes a subsequent `get` returns. */
  corruptOnRead = false;
  failPut = false;
  failGet = false;

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

function makeRecord(overrides: Partial<ArchiveFileRecord> = {}): ArchiveFileRecord {
  return {
    fileId: 'f-1',
    workspaceId: 'ws-1',
    name: 'photo.png',
    mimeType: 'image/png',
    storageKey: 'workspaces/ws-1/f-1/photo.png',
    archiveState: 'active_r2',
    archiveLocator: null,
    archiveHash: null,
    ...overrides,
  };
}

interface Harness {
  active: MemoryStore;
  archive: MemoryArchive;
  transitions: ArchiveTransition[];
  deps: ArchiveDeps;
}

function makeHarness(options: { failCanonicalUpdate?: boolean } = {}): Harness {
  const active = new MemoryStore();
  const archive = new MemoryArchive();
  const transitions: ArchiveTransition[] = [];
  const deps: ArchiveDeps = {
    active,
    archive,
    updateFile: async (_fileId, patch) => {
      // Models the canonical transition failing after the verified copy exists;
      // the earlier intent write and the reconciliation write still succeed.
      if (options.failCanonicalUpdate && patch.archiveState === 'archived_drive') {
        throw new Error('state update refused');
      }
      transitions.push(patch);
    },
  };
  return { active, archive, transitions, deps };
}

describe('archiveFile', () => {
  it('copies, verifies the destination, then deletes the source', async () => {
    const h = makeHarness();
    const bytes = Buffer.from('hello archive');
    h.active.objects.set('workspaces/ws-1/f-1/photo.png', bytes);

    const result = await archiveFile(h.deps, makeRecord());

    expect(result.ok).toBe(true);
    // Source pruned only after the cold copy was verified.
    expect(h.active.objects.has('workspaces/ws-1/f-1/photo.png')).toBe(false);
    expect(h.archive.objects.size).toBe(1);
    // Canonical state ends at archived_drive with the verified hash.
    const last = h.transitions.at(-1)!;
    expect(last.archiveState).toBe('archived_drive');
    expect(last.archiveHash).toBe(sha256(bytes));
  });

  it('records intent to archive before the copy', async () => {
    const h = makeHarness();
    h.active.objects.set('workspaces/ws-1/f-1/photo.png', Buffer.from('bytes'));

    await archiveFile(h.deps, makeRecord());

    // A crash mid-flight must be visible as `archiving`, so that state is
    // persisted before the upload starts.
    expect(h.transitions[0]!.archiveState).toBe('archiving');
  });

  it('preserves both copies and requires reconciliation when verification fails', async () => {
    const h = makeHarness();
    h.active.objects.set('workspaces/ws-1/f-1/photo.png', Buffer.from('original'));
    h.archive.corruptOnRead = true;

    const result = await archiveFile(h.deps, makeRecord());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('ARCHIVE_VERIFY_FAILED');
    expect(result.reconciliationRequired).toBe(true);
    // The only verified copy (R2) must survive an unverifiable destination.
    expect(h.active.objects.has('workspaces/ws-1/f-1/photo.png')).toBe(true);
    expect(h.transitions.at(-1)!.archiveState).toBe('reconciliation_required');
  });

  it('preserves both copies when the canonical state update fails', async () => {
    const h = makeHarness({ failCanonicalUpdate: true });
    h.active.objects.set('workspaces/ws-1/f-1/photo.png', Buffer.from('original'));

    const result = await archiveFile(h.deps, makeRecord());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('ARCHIVE_STATE_UPDATE_FAILED');
    expect(result.reconciliationRequired).toBe(true);
    // Bytes are safe in both tiers, and the source was never deleted.
    expect(h.active.objects.has('workspaces/ws-1/f-1/photo.png')).toBe(true);
    expect(h.archive.objects.size).toBe(1);
    expect(h.transitions.at(-1)!.archiveState).toBe('reconciliation_required');
  });

  it('does not delete the source when the upload fails', async () => {
    const h = makeHarness();
    h.active.objects.set('workspaces/ws-1/f-1/photo.png', Buffer.from('original'));
    h.archive.failPut = true;

    const result = await archiveFile(h.deps, makeRecord());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('ARCHIVE_UPLOAD_FAILED');
    expect(result.reconciliationRequired).toBe(false);
    expect(h.active.objects.has('workspaces/ws-1/f-1/photo.png')).toBe(true);
    expect(h.transitions.at(-1)!.archiveState).toBe('active_r2');
  });

  it('reports a pending prune without pretending the delete happened', async () => {
    const h = makeHarness();
    h.active.objects.set('workspaces/ws-1/f-1/photo.png', Buffer.from('bytes'));
    h.active.failDelete = true;

    const result = await archiveFile(h.deps, makeRecord());

    // The archive itself succeeded; the lingering copy is a benign duplicate.
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.detail).toMatch(/prune pending/);
    expect(h.transitions.at(-1)!.archiveState).toBe('archived_drive');
  });

  it('converges on a re-run instead of archiving a second copy', async () => {
    const h = makeHarness();
    h.active.objects.set('workspaces/ws-1/f-1/photo.png', Buffer.from('bytes'));

    const first = await archiveFile(h.deps, makeRecord());
    expect(first.ok).toBe(true);

    const locator = Array.from(h.archive.objects.keys())[0]!;
    const second = await archiveFile(
      h.deps,
      makeRecord({
        archiveState: 'archived_drive',
        archiveLocator: locator,
        archiveHash: sha256(Buffer.from('bytes')),
      })
    );

    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('unreachable');
    expect(second.reused).toBe(true);
    // Still exactly one cold object: the retry did not duplicate it.
    expect(h.archive.objects.size).toBe(1);
  });
});

describe('restoreFile', () => {
  it('is a no-op for a file that is already active', async () => {
    const h = makeHarness();
    h.active.objects.set('workspaces/ws-1/f-1/photo.png', Buffer.from('bytes'));

    const result = await restoreFile(h.deps, makeRecord({ archiveState: 'active_r2' }));

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.reused).toBe(true);
  });

  it('copies back from the cold tier and retains the archive locator', async () => {
    const h = makeHarness();
    const bytes = Buffer.from('cold bytes');
    h.archive.objects.set('drive-9', { data: bytes, mimeType: 'image/png' });

    const result = await restoreFile(
      h.deps,
      makeRecord({
        archiveState: 'archived_drive',
        archiveLocator: 'drive-9',
        archiveHash: sha256(bytes),
      })
    );

    expect(result.ok).toBe(true);
    expect(h.active.objects.get('workspaces/ws-1/f-1/photo.png')).toEqual(bytes);
    const last = h.transitions.at(-1)!;
    expect(last.archiveState).toBe('active_r2');
    // Restore is a copy-back: the cold copy is never orphaned.
    expect(last.archiveLocator).toBe('drive-9');
    expect(h.archive.objects.has('drive-9')).toBe(true);
  });

  it('refuses to trust a cold copy whose hash does not match the record', async () => {
    const h = makeHarness();
    h.archive.objects.set('drive-9', { data: Buffer.from('tampered'), mimeType: 'image/png' });

    const result = await restoreFile(
      h.deps,
      makeRecord({
        archiveState: 'archived_drive',
        archiveLocator: 'drive-9',
        archiveHash: sha256(Buffer.from('original')),
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('ARCHIVE_HASH_MISMATCH');
    expect(result.reconciliationRequired).toBe(true);
    // The bad bytes must not land in the active tier.
    expect(h.active.objects.has('workspaces/ws-1/f-1/photo.png')).toBe(false);
  });

  it('keeps the file archived when the cold read fails', async () => {
    const h = makeHarness();
    h.archive.failGet = true;

    const result = await restoreFile(
      h.deps,
      makeRecord({ archiveState: 'archived_drive', archiveLocator: 'drive-9' })
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('ARCHIVE_READ_FAILED');
    expect(h.transitions.at(-1)!.archiveState).toBe('archived_drive');
  });

  it('rejects a file with no archive locator', async () => {
    const h = makeHarness();

    const result = await restoreFile(h.deps, makeRecord({ archiveState: 'archived_drive' }));

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('INVALID_PAYLOAD');
  });
});
