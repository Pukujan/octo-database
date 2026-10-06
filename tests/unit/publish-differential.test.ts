/**
 * Differential checks for a published copy (issue #175).
 *
 * Private bytes and public bytes are compared directly. Publish itself must
 * not change the private object.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { clearPublishedObject, publishSnapshot } from '../../src/storage/publish-service';

const FILE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STORAGE_KEY = `workspaces/ws/${FILE_ID}/source.bin`;

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function stores() {
  const active = new Map<string, Buffer>();
  const published = new Map<string, { bytes: Buffer; contentType: string }>();
  return { active, published };
}

async function publish(active: Map<string, Buffer>, published: Map<string, { bytes: Buffer; contentType: string }>, mimeType: string) {
  return publishSnapshot({
    fileId: FILE_ID,
    mimeType,
    archiveState: 'active_r2',
    baseUrl: 'https://files.example.com',
    activeBytes: active.get(STORAGE_KEY) ?? null,
    writePublic: async (key, bytes, contentType) => {
      published.set(key, { bytes: Buffer.from(bytes), contentType });
    },
  });
}

describe('publish differential', () => {
  it('matches private and public bytes, then only the public copy, until republish', async () => {
    const { active, published } = stores();
    const original = Buffer.from('same-bytes');
    active.set(STORAGE_KEY, original);
    const privateBefore = sha256(original);

    const first = await publish(active, published, 'text/plain');
    expect(first.ok).toBe(true);
    expect(sha256(active.get(STORAGE_KEY)!)).toBe(privateBefore);
    expect(sha256(published.get(FILE_ID)!.bytes)).toBe(privateBefore);

    active.set(STORAGE_KEY, Buffer.from('active-changed'));
    expect(sha256(published.get(FILE_ID)!.bytes)).not.toBe(sha256(active.get(STORAGE_KEY)!));

    const again = await publish(active, published, 'text/plain');
    expect(again.ok).toBe(true);
    expect(sha256(published.get(FILE_ID)!.bytes)).toBe(sha256(active.get(STORAGE_KEY)!));
    expect(sha256(active.get(STORAGE_KEY)!)).not.toBe(privateBefore);
  });

  it('keeps the url and the public key stable and distinct from the private key', async () => {
    const { active, published } = stores();
    active.set(STORAGE_KEY, Buffer.from('stable'));
    const first = await publish(active, published, 'text/plain');
    const second = await publish(active, published, 'text/plain');
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.url).toBe(first.url);
      expect(second.publicKey).toBe(first.publicKey);
      expect(second.publicKey).not.toBe(STORAGE_KEY);
    }
    expect(active.has(STORAGE_KEY)).toBe(true);
  });

  it('passes the catalog content type through unchanged', async () => {
    for (const mimeType of ['text/plain', 'image/png', 'application/vnd.octo.holdout+json']) {
      const { active, published } = stores();
      active.set(STORAGE_KEY, Buffer.from('typed'));
      const result = await publish(active, published, mimeType);
      expect(result.ok).toBe(true);
      expect(published.get(FILE_ID)?.contentType).toBe(mimeType);
      expect(published.get(FILE_ID)?.contentType).not.toBe('application/octet-stream');
    }
  });

  it('leaves the private object intact when the public copy is removed', async () => {
    const { active, published } = stores();
    const original = Buffer.from('keep-private');
    active.set(STORAGE_KEY, original);
    const before = sha256(original);
    await publish(active, published, 'text/plain');

    await clearPublishedObject({
      publishedAt: '2026-10-06T00:00:00.000Z',
      publicKey: FILE_ID,
      deletePublic: async (key) => {
        published.delete(key);
      },
    });

    expect(published.has(FILE_ID)).toBe(false);
    expect(active.get(STORAGE_KEY)?.byteLength).toBe(original.byteLength);
    expect(sha256(active.get(STORAGE_KEY)!)).toBe(before);
    expect(active.get(STORAGE_KEY)?.equals(original)).toBe(true);
  });
});
