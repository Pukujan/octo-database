/**
 * Metamorphic Tests: invariants that must hold for every input (Slice 13)
 *
 * Unlike an example test, which pins one chosen input to one chosen output,
 * these assert a *relation* over a generated family of inputs. A single
 * counterexample fails the suite. The relations are the ones the workspace
 * data-plane design promises:
 *
 *   MR-A  Archive round-trip fidelity: restore(archive(f)) preserves bytes.
 *   MR-B  Archive state is single-valued and never loses the last copy.
 *   MR-C  Scope monotonicity: dropping a scope can only remove capabilities.
 *   MR-D  Key containment: a key's reach never exceeds its scope list's reach.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import { ObjectStore } from '../../src/storage/object-store';
import { ArchiveStore } from '../../src/storage/google-drive-provider';
import {
  ArchiveDeps,
  ArchiveFileRecord,
  ArchiveState,
  archiveFile,
  restoreFile,
} from '../../src/storage/archive-service';
import { capabilitiesForScopes, OctoScope } from '../../src/api/capabilities';

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Deterministic PRNG so a failing case reproduces from the seed alone. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class MemoryStore implements ObjectStore {
  readonly label = 'memory';
  readonly objects = new Map<string, Buffer>();
  async head(key: string): Promise<number | null> {
    const found = this.objects.get(key);
    return found ? found.byteLength : null;
  }
  async put(key: string, bytes: Buffer): Promise<void> {
    this.objects.set(key, Buffer.from(bytes));
  }
  async get(key: string): Promise<Buffer | null> {
    return this.objects.get(key) ?? null;
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

class MemoryArchive implements ArchiveStore {
  readonly label = 'google_drive';
  readonly objects = new Map<string, { data: Buffer; mimeType: string }>();
  private nextId = 1;
  async put(
    _name: string,
    bytes: Buffer,
    mimeType: string,
    existingLocator?: string | null
  ): Promise<{ locator: string; sizeBytes: number }> {
    const locator = existingLocator ?? `drive-${this.nextId++}`;
    this.objects.set(locator, { data: Buffer.from(bytes), mimeType });
    return { locator, sizeBytes: bytes.byteLength };
  }
  async get(locator: string): Promise<{ data: Buffer; sizeBytes: number; mimeType: string }> {
    const found = this.objects.get(locator);
    if (!found) throw new Error('drive object missing');
    return { data: found.data, sizeBytes: found.data.byteLength, mimeType: found.mimeType };
  }
  async delete(locator: string): Promise<void> {
    this.objects.delete(locator);
  }
  async exists(locator: string): Promise<boolean> {
    return this.objects.has(locator);
  }
}

const KNOWN_STATES: ArchiveState[] = [
  'active_r2',
  'archiving',
  'archived_drive',
  'restoring',
  'reconciliation_required',
];

interface Harness {
  active: MemoryStore;
  archive: MemoryArchive;
  record: ArchiveFileRecord;
  deps: ArchiveDeps;
  state: () => ArchiveState;
}

function makeHarness(bytes: Buffer, storageKey = 'workspaces/ws/f/object.bin'): Harness {
  const active = new MemoryStore();
  const archive = new MemoryArchive();
  active.objects.set(storageKey, Buffer.from(bytes));

  let state: ArchiveState = 'active_r2';
  const record: ArchiveFileRecord = {
    fileId: 'f-1',
    workspaceId: 'ws-1',
    name: 'object.bin',
    mimeType: 'application/octet-stream',
    storageKey,
    archiveState: 'active_r2',
    archiveLocator: null,
    archiveHash: null,
  };

  const deps: ArchiveDeps = {
    active,
    archive,
    updateFile: async (_fileId, patch) => {
      if (patch.archiveState) {
        state = patch.archiveState;
        record.archiveState = patch.archiveState;
      }
      if (patch.archiveLocator !== undefined) record.archiveLocator = patch.archiveLocator;
      if (patch.archiveHash !== undefined) record.archiveHash = patch.archiveHash;
    },
  };

  return { active, archive, record, deps, state: () => state };
}

/** True when the bytes exist in at least one tier — the last-copy invariant. */
function bytesExistSomewhere(h: Harness): boolean {
  return h.active.objects.has(h.record.storageKey) || h.archive.objects.size > 0;
}

describe('MR-A: archive round-trip fidelity', () => {
  it('restore(archive(f)) preserves the bytes of f for many random files', async () => {
    const rand = makeRandom(0x0c70);
    for (let i = 0; i < 40; i++) {
      const size = 1 + Math.floor(rand() * 4096);
      const original = Buffer.from(Array.from({ length: size }, () => Math.floor(rand() * 256)));
      const h = makeHarness(original);
      const originalHash = sha256(original);

      const archived = await archiveFile(h.deps, { ...h.record });
      expect(archived.ok).toBe(true);

      const restored = await restoreFile(h.deps, { ...h.record });
      expect(restored.ok).toBe(true);

      const back = h.active.objects.get(h.record.storageKey);
      expect(back).toBeTruthy();
      expect(sha256(back!)).toBe(originalHash);
    }
  });
});

describe('MR-B: archive state is single-valued and never loses the last copy', () => {
  it('after any sequence of transitions the state is defined and a copy survives', async () => {
    const rand = makeRandom(0x5eed);
    for (let i = 0; i < 40; i++) {
      const original = Buffer.from(`payload-${i}-${'x'.repeat(Math.floor(rand() * 512))}`);
      const h = makeHarness(original);

      const steps = 1 + Math.floor(rand() * 6);
      for (let s = 0; s < steps; s++) {
        const fn = rand() < 0.5 ? archiveFile : restoreFile;
        const result = await fn(h.deps, { ...h.record });
        if (result.ok) expect(bytesExistSomewhere(h)).toBe(true);
      }

      expect(KNOWN_STATES).toContain(h.state());
      expect(bytesExistSomewhere(h)).toBe(true);
    }
  });
});

describe('MR-C: scope monotonicity', () => {
  it('removing a scope can only remove capabilities, never add them', () => {
    const rand = makeRandom(0xbeef);
    const universe: OctoScope[] = ['read', 'write', 'files', 'delete'];

    for (let i = 0; i < 60; i++) {
      const broader = universe.filter(() => rand() < 0.6);
      // A strict subset: every member of `narrower` is in `broader`.
      const narrower = broader.filter(() => rand() < 0.5);

      const broadActions = new Set(capabilitiesForScopes(broader).map((c) => c.action));
      const narrowActions = capabilitiesForScopes(narrower).map((c) => c.action);

      for (const action of narrowActions) {
        expect(broadActions.has(action)).toBe(true);
      }
    }
  });
});

describe('MR-D: key containment', () => {
  it("a key's reach is a subset of its creator's reach", () => {
    const rand = makeRandom(0x1234);
    const universe: OctoScope[] = ['read', 'write', 'files', 'delete'];

    for (let i = 0; i < 60; i++) {
      const creatorScopes = universe.filter(() => rand() < 0.5);
      // A key can only be minted with scopes its creator already holds.
      const keyScopes = creatorScopes.filter(() => rand() < 0.5);

      const creatorActions = new Set(capabilitiesForScopes(creatorScopes).map((c) => c.action));
      const keyActions = capabilitiesForScopes(keyScopes);

      expect(keyActions.length).toBeLessThanOrEqual(creatorActions.size);
      for (const capability of keyActions) {
        expect(creatorActions.has(capability.action)).toBe(true);
      }
    }
  });
});
