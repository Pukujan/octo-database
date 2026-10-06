/**
 * Playwright E2E: MFA recovery-code single-use under concurrency (issue #138)
 *
 * A recovery code is documented as one-time, but consumption was a
 * read-modify-write: two concurrent step-ups both read the hash list, both found
 * the code, and the last write won — so one code could authorize several
 * destructive operations. Consumption must be a single atomic UPDATE that only
 * removes the hash when it is still present.
 *
 * The first test drives the atomic primitive directly and deterministically; the
 * second exercises the end-to-end one-time property through the delete gate.
 */

import { expect, test, APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { generateSync } from 'otplib/functional';
import { dbConsumeMfaRecoveryCode } from '../../src/server/db';
import { hashRecoveryCode } from '../../src/lib/mfa';
import { CONFIRM_SECRET, setConfirmSecret } from './confirm-secret';

interface GuestSession {
  principal: { id: string };
  workspace: { id: string; slug: string };
  sessionToken: string;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createGuest(request: APIRequestContext): Promise<GuestSession> {
  const response = await request.post('/api/auth/guest', {
    data: { displayName: `MFA concurrency E2E ${randomUUID()}` },
  });
  expect(response.status()).toBe(201);
  const session = (await response.json()) as GuestSession;
  await setConfirmSecret(request, session.sessionToken);
  return session;
}

async function enrollMfa(
  request: APIRequestContext,
  sessionToken: string
): Promise<string[]> {
  const begin = await request.post('/api/me/mfa/begin', { headers: bearer(sessionToken) });
  expect(begin.status()).toBe(200);
  const { secret } = (await begin.json()) as { secret: string };
  const confirm = await request.post('/api/me/mfa/confirm', {
    headers: bearer(sessionToken),
    data: { code: generateSync({ secret }) },
  });
  expect(confirm.status()).toBe(200);
  return ((await confirm.json()) as { recoveryCodes: string[] }).recoveryCodes;
}

test.describe('MFA recovery-code single use — concurrency', () => {
  test('concurrent consumption of one recovery code succeeds exactly once', async ({ request }) => {
    const session = await createGuest(request);
    const recoveryCodes = await enrollMfa(request, session.sessionToken);
    const hash = hashRecoveryCode(recoveryCodes[0]!);

    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => dbConsumeMfaRecoveryCode(session.principal.id, hash))
    );

    expect(outcomes.filter(Boolean)).toHaveLength(1);
  });

  test('simultaneous deletes with one recovery code yield exactly one success', async ({ request }) => {
    const session = await createGuest(request);
    const recoveryCodes = await enrollMfa(request, session.sessionToken);
    const recoveryCode = recoveryCodes[0]!;

    const attempts = await Promise.all(
      Array.from({ length: 6 }, () =>
        request.delete(`/api/workspaces/${session.workspace.id}`, {
          headers: bearer(session.sessionToken),
          data: { confirmSecret: CONFIRM_SECRET, confirmSlug: session.workspace.slug, mfaCode: recoveryCode },
        })
      )
    );

    const statuses = attempts.map((r) => r.status());
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    for (const response of attempts) {
      if (response.status() !== 200) {
        expect(response.status()).toBe(403);
        expect((await response.json()).error).toMatch(/MFA_CODE_INVALID/);
      }
    }
  });
});
