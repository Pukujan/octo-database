/**
 * Unit tests: the project-sync reconciliation planner.
 *
 * These pin the three-way classification without a filesystem or a network. The
 * safety property they exist to protect: absence on either side is NEVER a
 * deletion, so a partial local working set can never remove a canonical remote
 * record — and a duplicate remote record is reported, never resolved by picking
 * a "newest".
 */

import { describe, expect, it } from 'vitest';
import {
  classifyPath,
  groupRemoteByName,
  isSafeRelativePath,
  pathsToPull,
  pathsToPush,
  reconcile,
  recordIdsToSupersede,
  selectPaths,
  toRemotePath,
  type ClassifiedPath,
  type LocalFile,
  type SyncBaselineEntry,
} from '../../src/sync/reconcile';

function local(path: string, sha256: string, size = 10, mtimeMs = 1000): LocalFile {
  return { path, sha256, size, mtimeMs };
}

function baseline(remoteId: string, sha256 = 'h0'): SyncBaselineEntry {
  return { sha256, size: 10, mtimeMs: 1000, remoteId };
}

describe('classifyPath', () => {
  it('is in-sync when nothing changed', () => {
    expect(classifyPath(baseline('r1', 'h1'), local('a.txt', 'h1'), ['r1'])).toBe('in-sync');
  });

  it('is local-changed when only the local hash differs', () => {
    expect(classifyPath(baseline('r1', 'h1'), local('a.txt', 'h2'), ['r1'])).toBe('local-changed');
  });

  it('is remote-changed when only the remote id differs', () => {
    expect(classifyPath(baseline('r1', 'h1'), local('a.txt', 'h1'), ['r2'])).toBe('remote-changed');
  });

  it('is both-changed when both sides diverged', () => {
    expect(classifyPath(baseline('r1', 'h1'), local('a.txt', 'h2'), ['r2'])).toBe('both-changed');
  });

  it('is local-only for a new local file with no baseline or remote', () => {
    expect(classifyPath(undefined, local('new.txt', 'h1'), [])).toBe('local-only');
  });

  it('is remote-only for a new remote record with no baseline or local', () => {
    expect(classifyPath(undefined, undefined, ['r1'])).toBe('remote-only');
  });

  it('is untracked-both for an unbaselined path present on both sides', () => {
    expect(classifyPath(undefined, local('a.txt', 'h1'), ['r1'])).toBe('untracked-both');
  });

  it('reports local absence as local-absent, never a deletion to propagate', () => {
    expect(classifyPath(baseline('r1', 'h1'), undefined, ['r1'])).toBe('local-absent');
  });

  it('reports a missing remote as remote-removed, never a local deletion', () => {
    expect(classifyPath(baseline('r1', 'h1'), local('a.txt', 'h1'), [])).toBe('remote-removed');
  });

  it('treats a local delete plus a remote change as a conflict', () => {
    expect(classifyPath(baseline('r1', 'h1'), undefined, ['r2'])).toBe('both-changed');
  });

  it('flags more than one remote record at a path as ambiguous', () => {
    expect(classifyPath(baseline('r1', 'h1'), local('a.txt', 'h1'), ['r1', 'r2'])).toBe('ambiguous');
  });

  it('is in-sync when both sides are gone', () => {
    expect(classifyPath(baseline('r1', 'h1'), undefined, [])).toBe('in-sync');
  });
});

describe('reconcile', () => {
  it('classifies the union of baseline, local, and remote paths', () => {
    const paths = reconcile({
      baseline: { 'kept.txt': baseline('r1', 'h1'), 'gone.txt': baseline('r9', 'h9') },
      local: [local('kept.txt', 'h1'), local('added.txt', 'h2')],
      remote: [
        { id: 'r1', name: 'kept.txt', sizeBytes: 10 },
        { id: 'r9', name: 'gone.txt', sizeBytes: 10 },
        { id: 'r2', name: 'pulled.txt', sizeBytes: 5 },
      ],
    });
    const byPath = Object.fromEntries(paths.map((p) => [p.path, p.category]));
    expect(byPath).toEqual({
      'added.txt': 'local-only',
      'gone.txt': 'local-absent',
      'kept.txt': 'in-sync',
      'pulled.txt': 'remote-only',
    });
  });

  it('sorts paths so output is stable', () => {
    const paths = reconcile({
      baseline: {},
      local: [local('z.txt', 'h'), local('a.txt', 'h')],
      remote: [],
    });
    expect(paths.map((p) => p.path)).toEqual(['a.txt', 'z.txt']);
  });
});

describe('action selection', () => {
  const paths = reconcile({
    baseline: { 'conflict.txt': baseline('r1', 'h1'), 'gone.txt': baseline('r9', 'h9') },
    local: [local('conflict.txt', 'h2'), local('new.txt', 'h3')],
    remote: [{ id: 'r2', name: 'conflict.txt', sizeBytes: 1 }, { id: 'r5', name: 'fresh.txt', sizeBytes: 1 }],
  });

  it('pushes only local-changed and local-only paths', () => {
    expect(pathsToPush(paths).map((p) => p.path).sort()).toEqual(['new.txt']);
  });

  it('pulls only remote-changed and remote-only paths', () => {
    expect(pathsToPull(paths).map((p) => p.path).sort()).toEqual(['fresh.txt']);
  });

  it('leaves conflicts and absences for the operator, not an automatic action', () => {
    const auto = [...pathsToPush(paths), ...pathsToPull(paths)].map((p) => p.path);
    expect(auto).not.toContain('conflict.txt');
    expect(auto).not.toContain('gone.txt');
  });
});

describe('path safety and helpers', () => {
  it('rejects names that would escape the project root', () => {
    expect(isSafeRelativePath('docs/readme.md')).toBe(true);
    expect(isSafeRelativePath('../secrets.txt')).toBe(false);
    expect(isSafeRelativePath('a/../../b')).toBe(false);
    expect(isSafeRelativePath('/etc/passwd')).toBe(false);
    expect(isSafeRelativePath('C:\\Windows\\system32')).toBe(false);
    expect(isSafeRelativePath('')).toBe(false);
  });

  it('normalizes Windows separators to remote forward slashes', () => {
    expect(toRemotePath('docs\\sub\\a.txt')).toBe('docs/sub/a.txt');
  });

  it('groups remote ids by name so duplicates are visible', () => {
    const grouped = groupRemoteByName([
      { id: 'r1', name: 'a.txt', sizeBytes: 1 },
      { id: 'r2', name: 'a.txt', sizeBytes: 1 },
      { id: 'r3', name: 'b.txt', sizeBytes: 1 },
    ]);
    expect(grouped.get('a.txt')).toEqual(['r1', 'r2']);
    expect(grouped.get('b.txt')).toEqual(['r3']);
  });

  it('selects named paths and leaves the rest out', () => {
    const paths = reconcile({ baseline: {}, local: [local('a.txt', 'h'), local('b.txt', 'h')], remote: [] });
    expect(selectPaths(paths, ['a.txt']).map((p) => p.path)).toEqual(['a.txt']);
    expect(selectPaths(paths, []).map((p) => p.path)).toEqual(['a.txt', 'b.txt']);
  });
});

describe('recordIdsToSupersede', () => {
  function path(overrides: Partial<ClassifiedPath>): ClassifiedPath {
    return { path: 'a.txt', category: 'in-sync', remoteIds: [], ...overrides };
  }

  it('supersedes only the baseline record on a normal push', () => {
    const p = path({ category: 'local-changed', baseline: baseline('r1'), remoteIds: ['r1'] });
    expect(recordIdsToSupersede(p, 'r_new', false)).toEqual(['r1']);
  });

  it('leaves the current remote record alone when not forced', () => {
    const p = path({ category: 'untracked-both', remoteIds: ['r1'] });
    expect(recordIdsToSupersede(p, 'r_new', false)).toEqual([]);
  });

  it('removes the current remote record too on a forced overwrite', () => {
    const p = path({ category: 'both-changed', baseline: baseline('r1'), remoteIds: ['r2'] });
    expect(recordIdsToSupersede(p, 'r_new', true).sort()).toEqual(['r1', 'r2']);
  });

  it('removes the remote record on a forced first-contact overwrite', () => {
    const p = path({ category: 'untracked-both', remoteIds: ['r1'] });
    expect(recordIdsToSupersede(p, 'r_new', true)).toEqual(['r1']);
  });

  it('carries an interrupted replace forward', () => {
    const p = path({ baseline: { ...baseline('r1'), pendingDelete: ['r0'] }, remoteIds: ['r1'] });
    expect(recordIdsToSupersede(p, 'r_new', false).sort()).toEqual(['r0', 'r1']);
  });

  it('never returns the id it just uploaded', () => {
    const p = path({ baseline: baseline('r1'), remoteIds: ['r1'] });
    expect(recordIdsToSupersede(p, 'r1', false)).toEqual([]);
  });

  it('refuses to sweep duplicates even when forced', () => {
    const p = path({ category: 'ambiguous', baseline: baseline('r1'), remoteIds: ['r2', 'r3'] });
    expect(recordIdsToSupersede(p, 'r_new', true)).toEqual(['r1']);
  });
});
