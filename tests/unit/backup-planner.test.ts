/**
 * Unit tests: backup planner (managed Desktop/Downloads backup).
 *
 * The planner is pure: it decides, for each local file, whether it is backed up,
 * skipped as a temp/ignored file, or unchanged since the last run. Keeping this
 * logic out of the CLI is what makes "never touch local files, upload only what
 * changed" testable without a network or a real filesystem walk.
 */

import { describe, expect, it } from 'vitest';
import { classifyLocalFile, classifySize, remotePathFor, isUnchanged, sameStat, shouldSkipDirectory, type ManifestEntry } from '../../src/backup/planner';

describe('classifyLocalFile', () => {
  it('skips in-progress downloads and temp files', () => {
    expect(classifyLocalFile('movie.mp4.crdownload')).toBe('temp');
    expect(classifyLocalFile('archive.zip.part')).toBe('temp');
    expect(classifyLocalFile('notes.txt.tmp')).toBe('temp');
    expect(classifyLocalFile('~$budget.xlsx')).toBe('temp');
    expect(classifyLocalFile('file.tmp')).toBe('temp');
  });

  it('skips OS cruft via the ignore list', () => {
    expect(classifyLocalFile('.DS_Store', ['.DS_Store', 'Thumbs.db'])).toBe('ignored');
    expect(classifyLocalFile('Thumbs.db', ['.DS_Store', 'Thumbs.db'])).toBe('ignored');
  });

  it('keeps ordinary files', () => {
    expect(classifyLocalFile('photo.jpg')).toBeNull();
    expect(classifyLocalFile('report.pdf')).toBeNull();
    expect(classifyLocalFile('a.txt')).toBeNull();
  });
});

describe('classifySize', () => {
  it('skips empty files the upload API rejects as an empty payload', () => {
    expect(classifySize(0, 100)).toBe('empty');
  });

  it('skips files above the size cap', () => {
    expect(classifySize(101, 100)).toBe('too-large');
  });

  it('keeps ordinary files, including one exactly at the cap', () => {
    expect(classifySize(1, 100)).toBeNull();
    expect(classifySize(100, 100)).toBeNull();
  });
});

describe('shouldSkipDirectory', () => {
  it('prunes machine-generated directories so a Desktop backup is not mostly build output', () => {
    expect(shouldSkipDirectory('node_modules')).toBe(true);
    expect(shouldSkipDirectory('.git')).toBe(true);
    expect(shouldSkipDirectory('__pycache__')).toBe(true);
    expect(shouldSkipDirectory('.venv')).toBe(true);
    expect(shouldSkipDirectory('.cache')).toBe(true);
    expect(shouldSkipDirectory('.next')).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(shouldSkipDirectory('Node_Modules')).toBe(true);
  });

  it('honors the extra ignore list', () => {
    expect(shouldSkipDirectory('secrets', ['secrets'])).toBe(true);
  });

  it('keeps ordinary directories', () => {
    expect(shouldSkipDirectory('photos')).toBe(false);
    expect(shouldSkipDirectory('documents')).toBe(false);
    expect(shouldSkipDirectory('work')).toBe(false);
  });
});

describe('remotePathFor', () => {
  it('prefixes the file with its source so two folders never collide', () => {
    expect(remotePathFor('desktop', 'a/b.txt')).toBe('desktop/a/b.txt');
    expect(remotePathFor('downloads', 'a/b.txt')).toBe('downloads/a/b.txt');
  });

  it('normalizes Windows separators', () => {
    expect(remotePathFor('desktop', 'a\\b\\c.txt')).toBe('desktop/a/b/c.txt');
  });

  it('strips leading slashes', () => {
    expect(remotePathFor('desktop', '/a.txt')).toBe('desktop/a.txt');
  });
});

describe('isUnchanged', () => {
  const entry: ManifestEntry = { size: 100, mtimeMs: 1000, sha256: 'abc', remotePath: 'desktop/a.txt' };

  it('is unchanged when size, mtime, and hash all match', () => {
    expect(isUnchanged(entry, { size: 100, mtimeMs: 1000, sha256: 'abc' })).toBe(true);
  });

  it('is changed when the size differs', () => {
    expect(isUnchanged(entry, { size: 101, mtimeMs: 1000, sha256: 'abc' })).toBe(false);
  });

  it('is changed when the content hash differs even if size and mtime match', () => {
    expect(isUnchanged(entry, { size: 100, mtimeMs: 1000, sha256: 'def' })).toBe(false);
  });

  it('treats a missing manifest entry as changed', () => {
    expect(isUnchanged(undefined, { size: 100, mtimeMs: 1000, sha256: 'abc' })).toBe(false);
  });
});

describe('sameStat', () => {
  const entry: ManifestEntry = { size: 100, mtimeMs: 1000, sha256: 'abc', remotePath: 'desktop/a.txt' };

  it('matches when size and mtime are equal, without needing the hash', () => {
    expect(sameStat(entry, 100, 1000)).toBe(true);
  });

  it('does not match when size differs', () => {
    expect(sameStat(entry, 101, 1000)).toBe(false);
  });

  it('does not match when mtime differs', () => {
    expect(sameStat(entry, 100, 1001)).toBe(false);
  });

  it('does not match a missing entry', () => {
    expect(sameStat(undefined, 100, 1000)).toBe(false);
  });
});
