import { randomBytes } from 'crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TTL_MS = 10 * 60 * 1000;

type PendingChallenge = { code: string; expiresAt: number };

const pending = new Map<string, PendingChallenge>();

/** A fresh code the human types back. Replaces any unused code for that person. */
export function issueConfirmChallenge(
  principalId: string,
  now = Date.now()
): { code: string; expiresAt: string } {
  const bytes = randomBytes(6);
  let code = '';
  for (let i = 0; i < 6; i += 1) code += ALPHABET[bytes[i]! % ALPHABET.length];
  const expiresAt = now + TTL_MS;
  pending.set(principalId, { code, expiresAt });
  return { code, expiresAt: new Date(expiresAt).toISOString() };
}

export function hasConfirmChallenge(principalId: string, now = Date.now()): boolean {
  const row = pending.get(principalId);
  return Boolean(row && row.expiresAt > now);
}

/** True only when the typed value is the live code. A match is single-use. */
export function acceptConfirmChallenge(principalId: string, supplied: unknown, now = Date.now()): boolean {
  if (typeof supplied !== 'string') return false;
  const row = pending.get(principalId);
  if (!row || row.expiresAt <= now) return false;
  if (row.code !== supplied.trim().toUpperCase()) return false;
  pending.delete(principalId);
  return true;
}
