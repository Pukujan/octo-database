/**
 * Public publish snapshot (issue #175).
 *
 * The service copies one active object to a public key equal to the file id.
 * It does not move the private object, and it does not care what the file is named.
 */

import { describe, expect, it } from 'vitest';
import { clearPublishedObject, publishSnapshot } from '../../src/storage/publish-service';

const FILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STORAGE_KEY = `workspaces/ws-1/${FILE_ID}/notes.txt`;
const BASE = 'https://files.example.com';

function memoryWriter() {
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  return {
    objects,
    async write(key: string, bytes: Buffer, contentType: string) {
      objects.set(key, { bytes: Buffer.from(bytes), contentType });
    },
    async remove(key: string) {
      objects.delete(key);
    },
  };
}

describe('publish snapshot', () => {
  it('copies notes.txt with no name-prefix check and leaves the private bytes', async () => {
    const original = Buffer.from('plain notes');
    const writer = memoryWriter();
    const result = await publishSnapshot({
      fileId: FILE_ID,
      mimeType: 'text/plain',
      archiveState: 'active_r2',
      baseUrl: BASE,
      activeBytes: original,
      writePublic: writer.write,
    });

    expect(result).toEqual({
      ok: true,
      url: `${BASE}/${FILE_ID}`,
      publicKey: FILE_ID,
    });
    expect(result.ok && result.publicKey).not.toBe(STORAGE_KEY);
    expect(writer.objects.get(FILE_ID)?.bytes.equals(original)).toBe(true);
    expect(original.equals(Buffer.from('plain notes'))).toBe(true);
  });

  it('records the catalog content type for png and the holdout mime', async () => {
    for (const mimeType of ['image/png', 'application/vnd.octo.holdout+json']) {
      const writer = memoryWriter();
      const result = await publishSnapshot({
        fileId: FILE_ID,
        mimeType,
        archiveState: 'active_r2',
        baseUrl: BASE,
        activeBytes: Buffer.from('bytes'),
        writePublic: writer.write,
      });
      expect(result.ok).toBe(true);
      expect(writer.objects.get(FILE_ID)?.contentType).toBe(mimeType);
    }
  });

  it('keeps the same url and key when republish replaces the public bytes', async () => {
    const writer = memoryWriter();
    let active = Buffer.from('first');
    const publish = () =>
      publishSnapshot({
        fileId: FILE_ID,
        mimeType: 'text/plain',
        archiveState: 'active_r2',
        baseUrl: BASE,
        activeBytes: active,
        writePublic: writer.write,
      });

    const first = await publish();
    active = Buffer.from('second');
    const second = await publish();

    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.url).toBe(first.url);
      expect(second.publicKey).toBe(first.publicKey);
    }
    expect(writer.objects.get(FILE_ID)?.bytes.equals(Buffer.from('second'))).toBe(true);
  });

  it('refuses every non-active archive state without writing or restoring', async () => {
    for (const archiveState of [
      'archiving',
      'archived_drive',
      'restoring',
      'reconciliation_required',
    ]) {
      let writes = 0;
      let restores = 0;
      const result = await publishSnapshot({
        fileId: FILE_ID,
        mimeType: 'text/plain',
        archiveState,
        baseUrl: BASE,
        activeBytes: Buffer.from('still here'),
        writePublic: async () => {
          writes += 1;
        },
        copyDirect: async () => {
          restores += 1;
        },
      });
      expect(result).toEqual({ ok: false, code: 'FILE_NOT_ACTIVE' });
      expect(writes).toBe(0);
      expect(restores).toBe(0);
    }
  });

  it('returns OBJECT_MISSING and writes nothing when the active object is gone', async () => {
    let writes = 0;
    const result = await publishSnapshot({
      fileId: FILE_ID,
      mimeType: 'text/plain',
      archiveState: 'active_r2',
      baseUrl: BASE,
      activeBytes: null,
      writePublic: async () => {
        writes += 1;
      },
    });
    expect(result).toEqual({ ok: false, code: 'OBJECT_MISSING' });
    expect(writes).toBe(0);
  });
});

describe('clear published object', () => {
  it('removes only the public object, and a second clear does not touch storage', async () => {
    const writer = memoryWriter();
    await writer.write(FILE_ID, Buffer.from('public'), 'text/plain');
    await writer.write(STORAGE_KEY, Buffer.from('private'), 'text/plain');

    const first = await clearPublishedObject({
      publishedAt: '2026-10-06T00:00:00.000Z',
      publicKey: FILE_ID,
      deletePublic: writer.remove,
    });
    expect(first.deleted).toBe(true);
    expect(writer.objects.has(FILE_ID)).toBe(false);
    expect(writer.objects.get(STORAGE_KEY)?.bytes.equals(Buffer.from('private'))).toBe(true);

    let calls = 0;
    const second = await clearPublishedObject({
      publishedAt: null,
      publicKey: null,
      deletePublic: async () => {
        calls += 1;
      },
    });
    expect(second.deleted).toBe(false);
    expect(calls).toBe(0);
  });
});
