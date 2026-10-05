/**
 * Playwright E2E HOLDOUT: MFA step-up for creation and minting (Slice 18, #126)
 *
 * This is the slice's declared hidden holdout. It exercises the same success
 * claim — a stamped operation requires a second factor once MFA is enrolled —
 * under scenario details the public spec never uses: the principal satisfies the
 * step-up with a **recovery code** rather than a TOTP code, and that same code
 * is then presented to a *different* stamped operation.
 *
 * A naive implementation that consumed recovery codes only on the delete path
 * (or kept a per-operation set) would accept the reused code here. A correct
 * implementation shares one single-use set across every stamped operation, so
 * the code works once and is refused thereafter.
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
    data: { displayName: `MFA Create Holdout ${randomUUID()}` },
  });
  expect(response.status()).toBe(201);
  const session = (await response.json()) as GuestSession;
  await setConfirmSecret(request, session.sessionToken);
  return session;
}

test.describe('MFA step-up for creation and minting — holdout', () => {
  test('a recovery code satisfies one stamped operation and is refused on the next', async ({
    request,
  }) => {
    const session = await createGuest(request);

    const begin = await request.post('/api/me/mfa/begin', { headers: bearer(session.sessionToken) });
    expect(begin.status()).toBe(200);
    const { secret } = (await begin.json()) as { secret: string };
    const confirm = await request.post('/api/me/mfa/confirm', {
      headers: bearer(session.sessionToken),
      data: { code: generateSync({ secret }) },
    });
    expect(confirm.status()).toBe(200);
    const { recoveryCodes } = (await confirm.json()) as { recoveryCodes: string[] };
    const recoveryCode = recoveryCodes[0]!;

    // The recovery code substitutes for the authenticator on creation...
    const created = await request.post('/api/workspaces', {
      headers: bearer(session.sessionToken),
      data: { name: `Holdout Create ${randomUUID()}`, confirmSecret: CONFIRM_SECRET, mfaCode: recoveryCode },
    });
    expect(created.status()).toBe(201);

    // ...and is now consumed, so it cannot satisfy a different stamped operation.
    const mint = await request.post('/api/keys', {
      headers: bearer(session.sessionToken),
      data: {
        name: 'Holdout Key',
        workspaceId: session.workspace.id,
        scopes: ['read', 'write', 'files', 'delete'],
        confirmSecret: CONFIRM_SECRET,
        mfaCode: recoveryCode,
      },
    });
    expect(mint.status()).toBe(403);
    expect((await mint.json()).error).toMatch(/MFA_CODE_INVALID/);

    // The authenticator itself remains valid for that same mint.
    const mintWithTotp = await request.post('/api/keys', {
      headers: bearer(session.sessionToken),
      data: {
        name: 'Holdout Key 2',
        workspaceId: session.workspace.id,
        scopes: ['read', 'write', 'files', 'delete'],
        confirmSecret: CONFIRM_SECRET,
        mfaCode: generateSync({ secret }),
      },
    });
    expect(mintWithTotp.status()).toBe(201);
  });
});
