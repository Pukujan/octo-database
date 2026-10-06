/**
 * Unit Tests: Signed session tokens (ISS-1)
 *
 * A bearer session token must be unguessable and expiring. These pin the two
 * properties that matter: a token only verifies under the secret that signed it
 * and before its expiry, and a bare principal UUID (the pre-fix credential) is
 * never accepted.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { signSessionToken, verifySessionToken, sessionTtlSeconds } from '../../src/lib/session-token';

const PRINCIPAL = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const SEVEN_DAYS = 7 * 24 * 3600;

describe('signed session tokens', () => {
  const original = process.env['OCTO_SESSION_SECRET'];
  beforeEach(() => {
    process.env['OCTO_SESSION_SECRET'] = 'unit-test-session-secret';
  });
  afterEach(() => {
    if (original === undefined) delete process.env['OCTO_SESSION_SECRET'];
    else process.env['OCTO_SESSION_SECRET'] = original;
  });

  it('round-trips a principal id', () => {
    const token = signSessionToken(PRINCIPAL);
    expect(token.startsWith('octo_sess_')).toBe(true);
    expect(verifySessionToken(token)).toBe(PRINCIPAL);
  });

  it('rejects a raw principal UUID (the pre-fix credential)', () => {
    expect(verifySessionToken(PRINCIPAL)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const token = signSessionToken(PRINCIPAL);
    const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    expect(verifySessionToken(flipped)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = signSessionToken(PRINCIPAL, -1);
    expect(verifySessionToken(token)).toBeNull();
  });

  it('rejects a token signed under a different secret', () => {
    const token = signSessionToken(PRINCIPAL);
    process.env['OCTO_SESSION_SECRET'] = 'a-different-secret';
    expect(verifySessionToken(token)).toBeNull();
  });

  it('rejects a signed token whose principal id is not a UUID', () => {
    const token = signSessionToken('not-a-uuid');
    expect(verifySessionToken(token)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifySessionToken('')).toBeNull();
    expect(verifySessionToken('octo_sess_')).toBeNull();
    expect(verifySessionToken('octo_sess_only.two')).toBeNull();
    expect(verifySessionToken('octo_sess_a.b.c.d')).toBeNull();
    expect(verifySessionToken(`${PRINCIPAL}.9999999999.deadbeef`)).toBeNull();
  });
});

describe('configurable session lifetime', () => {
  const originalTtl = process.env['OCTO_SESSION_TTL_SECONDS'];
  beforeEach(() => { delete process.env['OCTO_SESSION_TTL_SECONDS']; });
  afterEach(() => {
    if (originalTtl === undefined) delete process.env['OCTO_SESSION_TTL_SECONDS'];
    else process.env['OCTO_SESSION_TTL_SECONDS'] = originalTtl;
  });

  it('defaults to seven days when unset', () => {
    expect(sessionTtlSeconds()).toBe(SEVEN_DAYS);
  });

  it('honours a configured lifetime', () => {
    process.env['OCTO_SESSION_TTL_SECONDS'] = '3600';
    expect(sessionTtlSeconds()).toBe(3600);
  });

  it('falls back to the default for non-numeric or non-positive values', () => {
    process.env['OCTO_SESSION_TTL_SECONDS'] = 'not-a-number';
    expect(sessionTtlSeconds()).toBe(SEVEN_DAYS);
    process.env['OCTO_SESSION_TTL_SECONDS'] = '0';
    expect(sessionTtlSeconds()).toBe(SEVEN_DAYS);
    process.env['OCTO_SESSION_TTL_SECONDS'] = '-100';
    expect(sessionTtlSeconds()).toBe(SEVEN_DAYS);
  });

  it('mints tokens that expire at the configured lifetime', () => {
    process.env['OCTO_SESSION_TTL_SECONDS'] = '60';
    const token = signSessionToken(PRINCIPAL);
    const exp = Number(token.split('.')[1]);
    const expected = Math.floor(Date.now() / 1000) + 60;
    expect(Math.abs(exp - expected)).toBeLessThanOrEqual(1);
  });
});
