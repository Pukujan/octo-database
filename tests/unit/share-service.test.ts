/**
 * Unit Tests: Scoped Share Links (Slice 4)
 */

import { describe, expect, it } from 'vitest';
import {
  hashShareToken,
  isShareActive,
  redactShareToken,
  shareHashesMatch,
  ShareRecord,
} from '../../src/media/share-service';

function makeShare(overrides: Partial<ShareRecord> = {}): ShareRecord {
  return {
    id: 'share-1',
    workspaceId: 'ws-1',
    resourceType: 'gallery',
    resourceId: null,
    tokenPrefix: 'octo_share_abcdefg',
    permission: 'read',
    validFrom: new Date(Date.now() - 60_000).toISOString(),
    validUntil: null,
    revokedAt: null,
    createdBy: 'p-1',
    createdAt: new Date().toISOString(),
    lastAccessedAt: null,
    accessCount: 0,
    ...overrides,
  };
}

describe('Share token hashing', () => {
  it('hashes tokens deterministically without storing the raw value', () => {
    const raw = 'octo_share_supersecrettoken';
    const hash = hashShareToken(raw);

    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(raw);
    expect(hashShareToken(raw)).toBe(hash);
    expect(hashShareToken('octo_share_different')).not.toBe(hash);
  });

  it('compares hashes in constant time and rejects length mismatches', () => {
    const a = hashShareToken('octo_share_one');
    const b = hashShareToken('octo_share_one');
    const c = hashShareToken('octo_share_two');

    expect(shareHashesMatch(a, b)).toBe(true);
    expect(shareHashesMatch(a, c)).toBe(false);
    expect(shareHashesMatch(a, 'short')).toBe(false);
  });

  it('redacts tokens for audit output without revealing the secret', () => {
    const raw = 'octo_share_abcdefghijklmnopqrstuvwxyz0123456789';
    const redacted = redactShareToken(raw);

    expect(redacted).toContain('[redacted]');
    expect(redacted).not.toBe(raw);
    // The bulk of the secret must not survive redaction.
    expect(redacted.length).toBeLessThan(raw.length);
    expect(redacted).not.toContain('qrstuvwxyz0123456789');
  });
});

describe('Share activity evaluation', () => {
  it('treats a plain share as active', () => {
    expect(isShareActive(makeShare())).toBe(true);
  });

  it('treats a revoked share as inactive regardless of expiry', () => {
    expect(isShareActive(makeShare({ revokedAt: new Date().toISOString() }))).toBe(false);
  });

  it('is inactive before valid_from', () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    expect(isShareActive(makeShare({ validFrom: future }))).toBe(false);
  });

  it('expires exactly at valid_until and stays expired after', () => {
    const at = new Date('2026-10-01T12:00:00Z');
    const share = makeShare({
      validFrom: new Date(at.getTime() - 3600_000).toISOString(),
      validUntil: at.toISOString(),
    });

    // One second before the boundary the link still works.
    expect(isShareActive(share, new Date(at.getTime() - 1000))).toBe(true);
    // At the configured instant it is already expired.
    expect(isShareActive(share, at)).toBe(false);
    // And remains expired afterwards.
    expect(isShareActive(share, new Date(at.getTime() + 1000))).toBe(false);
  });
});
