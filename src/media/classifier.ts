/**
 * Media Type Classifier (Slice 3)
 *
 * Categorizes MIME types for workspace image/video gallery.
 */

export type MediaKind = 'image' | 'video' | 'other';

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
  'image/bmp',
  'image/avif',
]);

const VIDEO_MIME_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
]);

export function isImage(mimeType: string): boolean {
  if (!mimeType) return false;
  const normalized = mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
  return IMAGE_MIME_TYPES.has(normalized) || normalized.startsWith('image/');
}

export function isVideo(mimeType: string): boolean {
  if (!mimeType) return false;
  const normalized = mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
  return VIDEO_MIME_TYPES.has(normalized) || normalized.startsWith('video/');
}

export function isBrowserPlayableVideo(mimeType: string): boolean {
  if (!mimeType) return false;
  const normalized = mimeType.toLowerCase().split(';')[0]?.trim() ?? '';
  return normalized === 'video/mp4' || normalized === 'video/webm' || normalized === 'video/ogg';
}

export function getMediaKind(mimeType: string): MediaKind {
  if (isImage(mimeType)) return 'image';
  if (isVideo(mimeType)) return 'video';
  return 'other';
}
