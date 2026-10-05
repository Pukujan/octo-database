/**
 * Playwright E2E: MFA (TOTP) step-up for destructive commands (Slice 17, issue #125)
 *
 * The confirmation gate already refuses API-key callers and requires a human
 * confirmation secret. This slice adds a third, per-principal factor for
 * deletion: when a principal has an authenticator enrolled, a valid TOTP code
 * (or a one-time recovery code) is required *in addition to* the secret.
 * Enrollment is opt-in, so a principal without MFA deletes exactly as before.
 *
 * Public deterministic evals cover the accepted job (secret alone is refused,
 * code completes the delete) and the recovery path. The API-key, opt-in, and
 * recovery-consumption checks are the slice's targeted metamorphic properties.
 */

import { expect, test, APIRequestContext, Page } from '@playwright/test';
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
    data: { displayName: `MFA E2E ${randomUUID()}` },
  });
  expect(response.status()).toBe(201);
  const session = (await response.json()) as GuestSession;
  await setConfirmSecret(request, session.sessionToken);
  return session;
}

/** Begins and confirms MFA enrollment, returning the issued recovery codes. */
async function enrollMfa(
  request: APIRequestContext,
  sessionToken: string
): Promise<{ secret: string; recoveryCodes: string[] }> {
  const begin = await request.post('/api/me/mfa/begin', {
    headers: bearer(sessionToken),
  });
  expect(begin.status()).toBe(200);
  const { secret } = (await begin.json()) as { secret: string };

  const confirm = await request.post('/api/me/mfa/confirm', {
    headers: bearer(sessionToken),
    data: { code: generateSync({ secret }) },
  });
  expect(confirm.status()).toBe(200);
  const { recoveryCodes } = (await confirm.json()) as { recoveryCodes: string[] };
  return { secret, recoveryCodes };
}

function deleteWorkspace(
  request: APIRequestContext,
  sessionToken: string,
  workspace: { id: string; slug: string },
  extra: Record<string, unknown> = {}
) {
  return request.delete(`/api/workspaces/${workspace.id}`, {
    headers: bearer(sessionToken),
    data: { confirmSecret: CONFIRM_SECRET, confirmSlug: workspace.slug, ...extra },
  });
}

test.describe('MFA step-up for deletion', () => {
  test('an MFA-enabled principal cannot delete with the secret alone, but can with a code', async ({
    request,
  }) => {
    const session = await createGuest(request);
    const { secret } = await enrollMfa(request, session.sessionToken);

    // Secret only: refused. The confirmation secret matched, so the refusal is
    // specifically the missing second factor.
    const withoutCode = await deleteWorkspace(request, session.sessionToken, session.workspace);
    expect(withoutCode.status()).toBe(403);
    expect((await withoutCode.json()).error).toMatch(/MFA_CODE_INVALID/);

    // A valid current code completes the delete.
    const withCode = await deleteWorkspace(request, session.sessionToken, session.workspace, {
      mfaCode: generateSync({ secret }),
    });
    expect(withCode.status()).toBe(200);
  });

  // Metamorphic: change the enrollment state. A principal who never enrolled MFA
  // is unaffected — the slice is opt-in, so deletion still takes the secret only.
  test('a principal without MFA enrolled deletes with the secret alone', async ({ request }) => {
    const session = await createGuest(request);
    const response = await deleteWorkspace(request, session.sessionToken, session.workspace);
    expect(response.status()).toBe(200);
  });

  // Metamorphic: change the credential class. An API key is refused before any
  // MFA check, whether or not the principal behind it has MFA enrolled.
  test('an API-key caller is refused regardless of MFA', async ({ request }) => {
    const session = await createGuest(request);
    await enrollMfa(request, session.sessionToken);

    const minted = await request.post('/api/keys', {
      headers: bearer(session.sessionToken),
      data: {
        name: 'mfa delete key',
        workspaceId: session.workspace.id,
        scopes: ['read', 'write', 'files', 'delete'],
        confirmSecret: CONFIRM_SECRET,
      },
    });
    expect(minted.status()).toBe(201);
    const { rawSecret } = (await minted.json()) as { rawSecret: string };

    const response = await request.delete(`/api/workspaces/${session.workspace.id}`, {
      headers: bearer(rawSecret),
      data: { confirmSecret: 'anything', confirmSlug: session.workspace.slug, mfaCode: '000000' },
    });
    expect(response.status()).toBe(403);
    expect((await response.json()).error).toMatch(/FORBIDDEN/);
  });

  test('a recovery code works once and is then consumed', async ({ request }) => {
    const session = await createGuest(request);
    const { recoveryCodes } = await enrollMfa(request, session.sessionToken);
    const recoveryCode = recoveryCodes[0]!;

    // Recovery codes substitute for the authenticator: the first delete succeeds.
    const first = await deleteWorkspace(request, session.sessionToken, session.workspace, {
      mfaCode: recoveryCode,
    });
    expect(first.status()).toBe(200);

    // The same code is single-use. A second attempt with the consumed code is
    // refused (the workspace is already gone, so the gate refusal comes first).
    const second = await deleteWorkspace(request, session.sessionToken, session.workspace, {
      mfaCode: recoveryCode,
    });
    expect(second.status()).toBe(403);
    expect((await second.json()).error).toMatch(/MFA_CODE_INVALID/);
  });

  test('enrollment is reversible: disabling MFA restores secret-only deletion', async ({
    request,
  }) => {
    const session = await createGuest(request);
    const { secret } = await enrollMfa(request, session.sessionToken);

    const disable = await request.post('/api/me/mfa/disable', {
      headers: bearer(session.sessionToken),
      data: { code: generateSync({ secret }) },
    });
    expect(disable.status()).toBe(200);

    // With MFA disabled, the secret alone is again sufficient.
    const response = await deleteWorkspace(request, session.sessionToken, session.workspace);
    expect(response.status()).toBe(200);
  });
});

/** Logs in as a guest and settles the initial workspace load. */
async function enterGuest(page: Page): Promise<void> {
  await page.goto('/');
  await page.click('text=Continue as Guest');
  await expect(page.locator('text=Workspace Control Dashboard')).toBeVisible();
  await page.waitForLoadState('networkidle');
}

test.describe('MFA step-up through the dashboard', () => {
  test('enroll from the Access page, then delete with a code in the modal', async ({ page }) => {
    await enterGuest(page);

    // Arm the confirmation secret first: the delete modal will ask for it.
    await page.evaluate(async (secret: string) => {
      const token = localStorage.getItem('octo_token');
      await fetch('/api/me/confirm-secret', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ secret }),
      });
    }, CONFIRM_SECRET);
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Enroll from the Access page: the modal shows the secret once.
    await page.getByRole('button', { name: 'Access', exact: true }).click();
    await page.getByRole('button', { name: 'Set up two-factor authentication' }).click();
    await expect(page.getByRole('dialog').getByText('Set up two-factor authentication')).toBeVisible();
    const secret = (await page.getByRole('dialog').locator('.secret-box code').innerText()).trim();

    await page.getByRole('dialog').locator('input[name="code"]').fill(generateSync({ secret }));
    await page.getByRole('dialog').getByRole('button', { name: 'Confirm and enable' }).click();

    // Recovery codes are issued exactly once; acknowledge and continue.
    await expect(page.getByRole('dialog').getByText('Save your recovery codes')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('heading', { name: 'Two-factor authentication' })).toBeVisible();
    await expect(page.getByText(/Enabled\. \d+ recovery codes remaining\./)).toBeVisible();

    // The delete modal now asks for an authenticator code, and the coded delete
    // succeeds through the real UI.
    await page.getByRole('button', { name: 'Delete Workspace' }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: /^Delete / })).toBeVisible();
    await page.getByRole('dialog').locator('input[name="slug"]').fill(await page.evaluate(async () => {
      const token = localStorage.getItem('octo_token');
      const list = await (
        await fetch('/api/workspaces', { headers: { Authorization: `Bearer ${token}` } })
      ).json();
      return (list as { slug: string }[])[0]!.slug;
    }));
    await page.getByRole('dialog').locator('input[name="mfaCode"]').fill(generateSync({ secret }));
    await page.getByRole('dialog').getByLabel('Confirmation secret', { exact: true }).fill(CONFIRM_SECRET);
    await page.getByRole('dialog').getByRole('button', { name: 'Delete workspace' }).click();

    await expect(page.getByRole('dialog').getByRole('heading', { name: /^Delete / })).toHaveCount(0);
  });
});
