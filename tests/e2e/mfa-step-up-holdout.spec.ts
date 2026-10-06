/**
 * Playwright E2E HOLDOUT: MFA (TOTP) step-up for deletion (Slice 17, issue #125)
 *
 * This is the slice's declared hidden holdout. It exercises the same success
 * claim as the public spec — a destructive delete requires a current second
 * factor — under scenario details the public fixtures never use: the principal
 * enrolls, then *rotates* its recovery codes, and a code issued before the
 * rotation is presented against a workspace that still exists.
 *
 * A naive implementation that appends recovery codes instead of replacing them
 * would accept the stale code and fail this test. A correct implementation
 * replaces the set on rotation, so the pre-rotation code is refused and a
 * post-rotation code completes the delete.
 */

import { expect, test, APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { generateSync } from 'otplib/functional';
import { CONFIRM_SECRET, setConfirmSecret } from './confirm-secret';

interface GuestSession {
  principal: { id: string; isGuest: boolean };
  workspace: { id: string; slug: string };
  sessionToken: string;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createGuest(request: APIRequestContext): Promise<GuestSession> {
  const response = await request.post('/api/auth/guest', {
    data: { displayName: `MFA Holdout ${randomUUID()}` },
  });
  expect(response.status()).toBe(201);
  const session = (await response.json()) as GuestSession;
  await setConfirmSecret(request, session.sessionToken);
  return session;
}

function deleteWorkspace(
  request: APIRequestContext,
  sessionToken: string,
  workspace: { id: string; slug: string },
  mfaCode: string
) {
  return request.delete(`/api/workspaces/${workspace.id}`, {
    headers: bearer(sessionToken),
    data: { confirmSecret: CONFIRM_SECRET, confirmSlug: workspace.slug, mfaCode },
  });
}

test.describe('MFA step-up — holdout', () => {
  test('rotating recovery codes invalidates the previous set', async ({ request }) => {
    const session = await createGuest(request);

    const begin = await request.post('/api/me/mfa/begin', { headers: bearer(session.sessionToken) });
    expect(begin.status()).toBe(200);
    const { secret } = (await begin.json()) as { secret: string };

    const confirm = await request.post('/api/me/mfa/confirm', {
      headers: bearer(session.sessionToken),
      data: { code: generateSync({ secret }) },
    });
    expect(confirm.status()).toBe(200);
    const firstSet = ((await confirm.json()) as { recoveryCodes: string[] }).recoveryCodes;
    expect(firstSet).toHaveLength(10);

    // Rotate: the returned set must be new, and the old set must stop working.
    const rotate = await request.post('/api/me/mfa/recovery-codes', {
      headers: bearer(session.sessionToken),
      data: { code: generateSync({ secret }) },
    });
    expect(rotate.status()).toBe(200);
    const secondSet = ((await rotate.json()) as { recoveryCodes: string[] }).recoveryCodes;
    expect(secondSet).toHaveLength(10);
    expect(secondSet).not.toEqual(firstSet);

    // A code from the retired set is refused...
    const stale = await deleteWorkspace(request, session.sessionToken, session.workspace, firstSet[0]!);
    expect(stale.status()).toBe(403);
    expect((await stale.json()).error).toMatch(/MFA_CODE_INVALID/);

    // ...while a code from the current set completes the delete.
    const fresh = await deleteWorkspace(request, session.sessionToken, session.workspace, secondSet[0]!);
    expect(fresh.status()).toBe(200);
  });
});
