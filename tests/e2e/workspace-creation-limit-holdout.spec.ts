/**
 * Playwright E2E HOLDOUT: Workspace-creation daily limit (Slice 16, issue #124)
 *
 * This is the slice's declared hidden holdout. It exercises the same success
 * claim as the public spec (a non-owner may create one workspace per rolling
 * day) under scenario details the public fixtures do not use: the principal
 * arrives with several pre-existing workspaces of mixed provenance and age.
 *
 * A naive implementation that counts every row the principal owns would fail
 * here, because the auto-provisioned sandbox and creations older than the window
 * must not consume the quota. A correct implementation counts only
 * API-created workspaces inside the rolling day.
 */

import { expect, test, APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { queryService } from '../../src/server/db';
import { CONFIRM_SECRET, setConfirmSecret } from './confirm-secret';

interface GuestSession {
  principal: { id: string };
  sessionToken: string;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createGuest(request: APIRequestContext): Promise<GuestSession> {
  const response = await request.post('/api/auth/guest', {
    data: { displayName: `Holdout E2E ${randomUUID()}` },
  });
  expect(response.status()).toBe(201);
  const session = (await response.json()) as GuestSession;
  await setConfirmSecret(request, session.sessionToken);
  return session;
}

test.describe('Workspace creation daily limit — holdout', () => {
  test('a principal with old API-created workspaces and a fresh sandbox may still create once', async ({
    request,
  }) => {
    const principal = await createGuest(request);

    // Seed history the public tests never create: two API-created workspaces
    // that are already outside the rolling window, each owned by this principal.
    for (const ageHours of [30, 40]) {
      await queryService(
        `INSERT INTO octo.workspaces (id, slug, name, description, created_by, auto_provisioned, created_at)
         VALUES ($1, $2, $3, 'holdout seed', $4, false, now() - ($5 || ' hours')::interval)`,
        [randomUUID(), `holdout-${randomUUID()}`, `Holdout Old ${ageHours}h`, principal.principal.id, String(ageHours)]
      );
    }

    // The principal already owns its fresh auto-provisioned sandbox plus two old
    // API-created workspaces. Neither consumes the quota, so the first fresh
    // creation succeeds...
    const first = await request.post('/api/workspaces', {
      headers: bearer(principal.sessionToken),
      data: { name: `Holdout Fresh ${randomUUID()}`, confirmSecret: CONFIRM_SECRET },
    });
    expect(first.status()).toBe(201);

    // ...and the second within the window is refused.
    const second = await request.post('/api/workspaces', {
      headers: bearer(principal.sessionToken),
      data: { name: `Holdout Fresh Again ${randomUUID()}`, confirmSecret: CONFIRM_SECRET },
    });
    expect(second.status()).toBe(429);
    expect((await second.json()).error).toMatch(/WORKSPACE_DAILY_LIMIT/);
  });
});
