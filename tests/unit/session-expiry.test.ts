/**
 * Unit tests: client-side session expiry (session timeout)
 *
 * The browser cannot import the signing module (it pulls in node crypto), so it
 * reads the expiry the server already embedded in the token. These pin that the
 * reader returns the right instant, tolerates malformed input, and never treats a
 * non-session token as expired.
 */

import { describe, expect, it } from 'vitest';
import { isSessionExpired, sessionExpiryMs } from '../../src/lib/session-expiry';

const PRINCIPAL = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';

describe('client session expiry', () => {
  it('reads the expiry embedded in a session token', () => {
    const token = `octo_sess_${PRINCIPAL}.2000000000.sig`;
    expect(sessionExpiryMs(token)).toBe(2000000000 * 1000);
  });

  it('treats a token past its expiry as expired', () => {
    const token = `octo_sess_${PRINCIPAL}.1000.sig`;
    expect(isSessionExpired(token, 2000 * 1000)).toBe(true);
  });

  it('treats a token before its expiry as live', () => {
    const token = `octo_sess_${PRINCIPAL}.2000.sig`;
    expect(isSessionExpired(token, 1000 * 1000)).toBe(false);
  });

  it('returns null for non-session or malformed tokens', () => {
    expect(sessionExpiryMs(null)).toBeNull();
    expect(sessionExpiryMs('')).toBeNull();
    expect(sessionExpiryMs(PRINCIPAL)).toBeNull();
    expect(sessionExpiryMs('octo_sess_only.two')).toBeNull();
    expect(sessionExpiryMs(`octo_sess_${PRINCIPAL}.notanumber.sig`)).toBeNull();
    expect(sessionExpiryMs(`octo_sess_${PRINCIPAL}.0.sig`)).toBeNull();
  });

  it('never reports a non-session token as expired', () => {
    expect(isSessionExpired('a-raw-uuid-or-api-key', Date.now())).toBe(false);
  });
});
