/**
 * Unit Tests: Media Classifier (Slice 3)
 */

import { describe, expect, it } from 'vitest';
import { getMediaKind, isBrowserPlayableVideo, isImage, isVideo } from '../../src/media/classifier';

describe('Media Type Classifier', () => {
  it('accurately identifies image MIME types', () => {
    expect(isImage('image/jpeg')).toBe(true);
    expect(isImage('image/png')).toBe(true);
    expect(isImage('image/webp')).toBe(true);
    expect(isImage('image/gif')).toBe(true);
    expect(isImage('image/svg+xml')).toBe(true);
    expect(isImage('image/avif')).toBe(true);

    expect(isImage('application/pdf')).toBe(false);
    expect(isImage('text/plain')).toBe(false);
    expect(isImage('video/mp4')).toBe(false);
  });

  it('accurately identifies video MIME types', () => {
    expect(isVideo('video/mp4')).toBe(true);
    expect(isVideo('video/webm')).toBe(true);
    expect(isVideo('video/ogg')).toBe(true);
    expect(isVideo('video/quicktime')).toBe(true);

    expect(isVideo('image/png')).toBe(false);
    expect(isVideo('application/json')).toBe(false);
  });

  it('detects browser-playable video formats', () => {
    expect(isBrowserPlayableVideo('video/mp4')).toBe(true);
    expect(isBrowserPlayableVideo('video/webm')).toBe(true);
    expect(isBrowserPlayableVideo('video/ogg')).toBe(true);

    expect(isBrowserPlayableVideo('video/quicktime')).toBe(false);
  });

  it('categorizes media into discrete kinds', () => {
    expect(getMediaKind('image/jpeg')).toBe('image');
    expect(getMediaKind('video/mp4')).toBe('video');
    expect(getMediaKind('application/pdf')).toBe('other');
    expect(getMediaKind('text/markdown')).toBe('other');
  });
});
