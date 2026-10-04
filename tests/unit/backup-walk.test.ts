/**
 * Unit tests: source-tree walk for the managed backup.
 *
 * The walk decides which files are handed to the planner and, crucially, what
 * path each is reported under. Paths must stay relative to the *source root*
 * (not the current directory) so nested folders survive into the workspace, and
 * machine-generated directories must be pruned before they are descended into.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { walkFiles } from '../../src/backup/walk';

function posix(p: string): string {
  return p.replace(/\\/g, '/');
}

describe('walkFiles', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'octo-walk-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('reports paths relative to the source root, preserving subdirectories', () => {
    mkdirSync(join(root, 'work', 'proj'), { recursive: true });
    writeFileSync(join(root, 'top.txt'), 'a');
    writeFileSync(join(root, 'work', 'proj', 'deep.txt'), 'b');

    const seen: string[] = [];
    walkFiles(root, (_absolute, relPath) => seen.push(posix(relPath)));

    expect(seen.sort()).toEqual(['top.txt', 'work/proj/deep.txt']);
  });

  it('prunes machine-generated directories instead of descending into them', () => {
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'pkg', 'index.js'), 'x');
    writeFileSync(join(root, 'src', 'app.ts'), 'y');

    const seen: string[] = [];
    walkFiles(root, (_absolute, relPath) => seen.push(posix(relPath)));

    expect(seen).toEqual(['src/app.ts']);
  });

  it('prunes directories named in the extra ignore list', () => {
    mkdirSync(join(root, 'secrets'), { recursive: true });
    writeFileSync(join(root, 'secrets', 'key.txt'), 'x');

    const seen: string[] = [];
    walkFiles(root, (_absolute, relPath) => seen.push(relPath), ['secrets']);

    expect(seen).toEqual([]);
  });

  it('returns quietly when the root does not exist', () => {
    const seen: string[] = [];
    walkFiles(join(root, 'nope'), (_absolute, relPath) => seen.push(relPath));
    expect(seen).toEqual([]);
  });
});
