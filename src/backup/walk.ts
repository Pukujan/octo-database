/**
 * Source-tree walk for the managed backup.
 *
 * Reports every eligible file under a source root, keyed by its path *relative
 * to that root* so nested folders are preserved into the workspace (a file at
 * `work/proj/deep.txt` stays there rather than collapsing to `deep.txt`).
 * Machine-generated directories are pruned before descent. The walk never
 * mutates the filesystem.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { shouldSkipDirectory } from './planner';

export function walkFiles(
  root: string,
  onFile: (absolutePath: string, relPath: string) => void,
  extraIgnoreDirs: string[] = []
): void {
  walk(root, root, onFile, extraIgnoreDirs);
}

function walk(
  root: string,
  dir: string,
  onFile: (absolutePath: string, relPath: string) => void,
  extraIgnoreDirs: string[]
): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let info;
    try {
      info = statSync(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      if (shouldSkipDirectory(entry, extraIgnoreDirs)) continue;
      walk(root, full, onFile, extraIgnoreDirs);
    } else {
      onFile(full, relative(root, full));
    }
  }
}
