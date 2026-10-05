/**
 * Unit tests: per-principal TOTP step-up (Slice 17).
 *
 * The TOTP secret is the one credential that cannot be hashed, because
 * verification needs the original value. These tests pin the two properties the
 * delete path relies on: a valid current code verifies while anything else fails
 * closed, and the at-rest envelope round-trips without ever leaving plaintext in
 * the database read.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { generateSync } from 'otplib/functional';
import {
  generateTotpSecret,
  totpProvisioningUri,
  verifyTotpCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  encryptSecret,
  decryptSecret,
} from '../../src/lib/mfa';

describe('verifyTotpCode', () => {
  it('accepts the current code for the secret', () => {
    const secret = generateTotpSecret();
    const token = generateSync({ secret });
    expect(verifyTotpCode(secret, token)).toBe(true);
  });

  it('rejects a wrong six-digit code', () => {
    const secret = generateTotpSecret();
    const token = generateSync({ secret });
    const wrong = token === '000000' ? '000001' : '000000';
    expect(verifyTotpCode(secret, wrong)).toBe(false);
  });

  it('rejects a code minted from a different secret', () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(verifyTotpCode(a, generateSync({ secret: b }))).toBe(false);
  });

  it('fails closed on malformed input instead of throwing', () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, 'not-a-code')).toBe(false);
    expect(verifyTotpCode(secret, '12345')).toBe(false);
    expect(verifyTotpCode(secret, 123456)).toBe(false);
    expect(verifyTotpCode(secret, undefined)).toBe(false);
    expect(verifyTotpCode('not-a-valid-secret', '123456')).toBe(false);
  });
});

describe('totpProvisioningUri', () => {
  it('identifies Octo and the account label', () => {
    const secret = generateTotpSecret();
    const uri = totpProvisioningUri(secret, 'person@example.com');
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('issuer=Octo');
    expect(uri).toContain(encodeURIComponent('person@example.com'));
    expect(uri).toContain(secret);
  });
});

describe('recovery codes', () => {
  it('mints ten distinct high-entropy codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[0-9a-f]{10}$/);
  });

  it('honours an explicit count', () => {
    expect(generateRecoveryCodes(3)).toHaveLength(3);
  });

  it('hashes stably and tolerates case and surrounding whitespace', () => {
    const code = 'a1b2c3d4e5';
    expect(hashRecoveryCode(code)).toBe(hashRecoveryCode('  A1B2C3D4E5  '));
  });

  it('gives different codes different hashes', () => {
    expect(hashRecoveryCode('aaaaaaaaaa')).not.toBe(hashRecoveryCode('bbbbbbbbbb'));
  });
});

describe('secret envelope', () => {
  const original = process.env['OCTO_MFA_SECRET'];
  beforeEach(() => {
    process.env['OCTO_MFA_SECRET'] = 'unit-test-mfa-secret';
  });
  afterEach(() => {
    if (original === undefined) delete process.env['OCTO_MFA_SECRET'];
    else process.env['OCTO_MFA_SECRET'] = original;
  });

  it('round-trips a secret', () => {
    const secret = generateTotpSecret();
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it('does not store the plaintext and varies with the IV', () => {
    const secret = generateTotpSecret();
    const first = encryptSecret(secret);
    const second = encryptSecret(secret);
    expect(first).not.toContain(secret);
    expect(first).not.toBe(second);
    expect(decryptSecret(first)).toBe(secret);
    expect(decryptSecret(second)).toBe(secret);
  });

  it('rejects a tampered envelope instead of returning garbage', () => {
    const blob = encryptSecret(generateTotpSecret());
    const [iv, tag, ciphertext] = blob.split('.');
    const flipped = Buffer.from(ciphertext!, 'base64');
    flipped[0] = flipped[0]! ^ 0xff;
    expect(() => decryptSecret([iv, tag, flipped.toString('base64')].join('.'))).toThrow();
    expect(() => decryptSecret('not-a-blob')).toThrow();
  });

  it('fails closed when the key is not configured', () => {
    delete process.env['OCTO_MFA_SECRET'];
    expect(() => encryptSecret('whatever')).toThrow(/MFA_NOT_CONFIGURED/);
  });

  it('cannot be decrypted under a different key', () => {
    const blob = encryptSecret(generateTotpSecret());
    process.env['OCTO_MFA_SECRET'] = 'a-different-key';
    expect(() => decryptSecret(blob)).toThrow();
  });
});
