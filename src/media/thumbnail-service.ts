/**
 * Thumbnail Derivative Service (Slice 3)
 *
 * Generates and caches small WebP derivatives so gallery grids never download
 * full originals. Derivatives are addressed by a stable key, making regeneration
 * idempotent: a retry reuses the existing object instead of creating a duplicate.
 */

import sharp from 'sharp';
import { ObjectStore } from '../storage/object-store';
import { isImage } from './classifier';

export const THUMBNAIL_MAX_EDGE = 400;

/** Stable derivative key for a logical file. Retrying yields the same key. */
export function derivedThumbnailKey(fileId: string): string {
  return `derived/${fileId}/thumb.webp`;
}

export interface ThumbnailResult {
  key: string;
  bytes: Buffer;
  contentType: string;
  /** True when an existing derivative was reused instead of regenerated. */
  cached: boolean;
}

/**
 * Returns a thumbnail derivative for an image file, generating it only when absent.
 * Non-image files return null so callers fall back to the original object.
 */
export async function ensureThumbnail(
  store: ObjectStore,
  fileId: string,
  originalKey: string,
  mimeType: string
): Promise<ThumbnailResult | null> {
  if (!isImage(mimeType)) return null;

  const key = derivedThumbnailKey(fileId);

  // Idempotency: reuse any existing derivative for this logical file.
  const existing = await store.get(key);
  if (existing) {
    return { key, bytes: existing, contentType: 'image/webp', cached: true };
  }

  const original = await store.get(originalKey);
  if (!original) return null;

  let derivative: Buffer;
  try {
    derivative = await sharp(original)
      .resize({ width: THUMBNAIL_MAX_EDGE, height: THUMBNAIL_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
  } catch {
    // Corrupt or unsupported image data: no derivative rather than a hard failure.
    return null;
  }

  await store.put(key, derivative, 'image/webp');

  return { key, bytes: derivative, contentType: 'image/webp', cached: false };
}
