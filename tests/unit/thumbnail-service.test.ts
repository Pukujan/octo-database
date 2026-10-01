/**
 * Unit Tests: Thumbnail Derivative Service (Slice 3)
 *
 * Verifies derivatives are small, stable-keyed, and idempotent on retry.
 */

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { ensureThumbnail, derivedThumbnailKey, THUMBNAIL_MAX_EDGE } from '../../src/media/thumbnail-service';
import { ObjectStore } from '../../src/storage/object-store';

class InMemoryObjectStore implements ObjectStore {
  readonly label = 'memory';
  readonly objects = new Map<string, Buffer>();
  putCount = 0;

  async head(key: string): Promise<number | null> {
    const found = this.objects.get(key);
    return found ? found.byteLength : null;
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    this.putCount += 1;
    this.objects.set(key, bytes);
  }

  async get(key: string): Promise<Buffer | null> {
    return this.objects.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

async function makeLargePng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 220, g: 40, b: 40 } },
  })
    .png()
    .toBuffer();
}

describe('Thumbnail Derivative Service', () => {
  it('uses a stable derivative key per logical file', () => {
    expect(derivedThumbnailKey('abc')).toBe('derived/abc/thumb.webp');
    expect(derivedThumbnailKey('abc')).toBe(derivedThumbnailKey('abc'));
  });

  it('generates a smaller WebP derivative from a large original', async () => {
    const store = new InMemoryObjectStore();
    const original = await makeLargePng(1600, 1200);
    store.objects.set('originals/big.png', original);

    const result = await ensureThumbnail(store, 'file-1', 'originals/big.png', 'image/png');

    expect(result).not.toBeNull();
    expect(result?.cached).toBe(false);
    expect(result?.contentType).toBe('image/webp');
    // Must be materially smaller than the original, not a passthrough copy.
    expect(result!.bytes.byteLength).toBeLessThan(original.byteLength);

    const meta = await sharp(result!.bytes).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(THUMBNAIL_MAX_EDGE);
  });

  it('reuses the cached derivative on retry instead of writing a duplicate', async () => {
    const store = new InMemoryObjectStore();
    const original = await makeLargePng(1200, 900);
    store.objects.set('originals/retry.png', original);

    const first = await ensureThumbnail(store, 'file-2', 'originals/retry.png', 'image/png');
    const second = await ensureThumbnail(store, 'file-2', 'originals/retry.png', 'image/png');

    expect(first?.cached).toBe(false);
    expect(second?.cached).toBe(true);
    // Exactly one write despite two calls: retry is idempotent.
    expect(store.putCount).toBe(1);
    // Only the original plus one derivative exist.
    expect(store.objects.size).toBe(2);
  });

  it('returns null for non-image media so callers fall back to the original', async () => {
    const store = new InMemoryObjectStore();
    store.objects.set('originals/clip.mp4', Buffer.from('not really a video'));

    const result = await ensureThumbnail(store, 'file-3', 'originals/clip.mp4', 'video/mp4');
    expect(result).toBeNull();
  });
});
