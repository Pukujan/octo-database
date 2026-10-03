/**
 * Security-Negative Tests: Scoped Share Links (Slice 4)
 *
 * Proves the share boundary: a token grants access to exactly one target and
 * nothing else, and revocation/expiry immediately remove that access.
 */

import { describe, expect, it } from 'vitest';
import { hashShareToken, isShareActive, ShareRecord } from '../../src/media/share-service';
import { signMediaUrl, verifyMediaToken } from '../../src/media/media-token';

function activeShare(overrides: Partial<ShareRecord> = {}): ShareRecord {
  return {
    id: 'share-target',
    workspaceId: 'ws-target',
    resourceType: 'gallery',
    resourceId: null,
    tokenPrefix: 'octo_share_prefix',
    permission: 'read',
    validFrom: new Date(Date.now() - 1000).toISOString(),
    validUntil: null,
    revokedAt: null,
    createdBy: 'p-owner',
    createdAt: new Date().toISOString(),
    lastAccessedAt: null,
    accessCount: 0,
    ...overrides,
  };
}

describe('Share token scope is not transferable', () => {
  it('a token only ever resolves to its own share record', () => {
    const tokenA = 'octo_share_tokenA';
    const tokenB = 'octo_share_tokenB';
    const shares = new Map([
      [hashShareToken(tokenA), activeShare({ id: 'share-A', workspaceId: 'ws-A' })],
      [hashShareToken(tokenB), activeShare({ id: 'share-B', workspaceId: 'ws-B' })],
    ]);

    const resolvedA = shares.get(hashShareToken(tokenA));
    expect(resolvedA?.id).toBe('share-A');
    expect(resolvedA?.workspaceId).toBe('ws-A');

    // Presenting B's token can never reach A's workspace, and vice versa.
    const resolvedB = shares.get(hashShareToken(tokenB));
    expect(resolvedB?.workspaceId).not.toBe('ws-A');
    expect(shares.get(hashShareToken('octo_share_forged'))).toBeUndefined();
  });

  it('a raw token is never recoverable from its stored hash', () => {
    const raw = 'octo_share_high_entropy_value';
    const stored = hashShareToken(raw);
    expect(stored).not.toBe(raw);
    expect(stored).not.toContain('high_entropy_value');
  });
});

describe('Revocation and expiry remove access immediately', () => {
  it('revoked shares fail activity evaluation at once', () => {
    const share = activeShare();
    expect(isShareActive(share)).toBe(true);

    const revoked = { ...share, revokedAt: new Date().toISOString() };
    expect(isShareActive(revoked)).toBe(false);
  });

  it('media URLs signed for a share do not outlive the share expiry', () => {
    const expiry = new Date(Date.now() + 30_000).toISOString();
    const url = signMediaUrl(
      '/api/files/thumbnail',
      { kind: 'share', fileId: 'f-1', workspaceId: 'ws-target', shareId: 'share-target' },
      3600,
      expiry
    );

    const params = new URLSearchParams(url.split('?')[1]);
    const exp = Number(params.get('exp'));

    // The 1-hour default must have been capped to the share's own expiry.
    expect(exp).toBeLessThanOrEqual(Math.floor(new Date(expiry).getTime() / 1000));
  });

  it('a share-signed media URL verifies and carries no principal', () => {
    const url = signMediaUrl('/api/files/content', {
      kind: 'share',
      fileId: 'f-9',
      workspaceId: 'ws-target',
      shareId: 'share-target',
    });
    const params = new URLSearchParams(url.split('?')[1]);

    const claims = verifyMediaToken(params);
    expect(claims).not.toBeNull();
    expect(claims?.kind).toBe('share');
    expect(params.get('principalId')).toBeNull();
    expect(params.get('shareId')).toBe('share-target');
  });

  it('rejects a tampered share signature and a swapped share id', () => {
    const url = signMediaUrl('/api/files/content', {
      kind: 'share',
      fileId: 'f-9',
      workspaceId: 'ws-target',
      shareId: 'share-target',
    });
    const params = new URLSearchParams(url.split('?')[1]);

    // Swap the share id to point at a different share: signature no longer matches.
    const swapped = new URLSearchParams(params);
    swapped.set('shareId', 'share-other');
    expect(verifyMediaToken(swapped)).toBeNull();

    // Tamper with the signature directly.
    const tampered = new URLSearchParams(params);
    tampered.set('sig', 'deadbeef');
    expect(verifyMediaToken(tampered)).toBeNull();
  });

  it('rejects an expired media token', () => {
    const url = signMediaUrl(
      '/api/files/content',
      { kind: 'share', fileId: 'f-1', workspaceId: 'ws-target', shareId: 'share-target' },
      -10
    );
    const params = new URLSearchParams(url.split('?')[1]);
    expect(verifyMediaToken(params)).toBeNull();
  });
});
