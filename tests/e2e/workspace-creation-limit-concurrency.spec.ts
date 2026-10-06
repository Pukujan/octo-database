/**
 * Playwright E2E: Workspace-creation daily limit under concurrency (issue #136)
 *
 * The Slice 16 quota is a check-then-act. If the count and the insert run on
 * separate connections, two requests that arrive together both observe an empty
 * window and both create a workspace, so a single principal can exceed its
 * one-per-day allowance by racing. The count and the insert must happen inside
 * one transaction, serialized per principal.
 *
 * This spec fires the same principal's create requests at once and asserts the
 * quota holds: exactly one 201, the rest 429, and exactly one row on disk.
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
    data: { displayName: `Concurrency E2E ${randomUUID()}` },
  });
  expect(response.status()).toBe(201);
  const session = (await response.json()) as GuestSession;
  await setConfirmSecret(request, session.sessionToken);
  return session;
}

test.describe('Workspace creation daily limit — concurrency', () => {
  test('simultaneous creates by one principal yield exactly one workspace', async ({ request }) => {
    const principal = await createGuest(request);

    const attempts = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        request.post('/api/workspaces', {
          headers: bearer(principal.sessionToken),
          data: { name: `Race ${i} ${randomUUID()}`, confirmSecret: CONFIRM_SECRET },
        })
      )
    );

    const statuses = attempts.map((r) => r.status());
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    for (const response of attempts) {
      if (response.status() === 429) {
        expect((await response.json()).error).toMatch(/WORKSPACE_DAILY_LIMIT/);
      }
    }
    expect(statuses.filter((s) => s === 429)).toHaveLength(5);

    // The database agrees: the quota allowed exactly one row through.
    const rows = await queryService<{ count: string }>(
      `SELECT count(*)::text AS count FROM octo.workspaces
       WHERE created_by = $1 AND auto_provisioned = false`,
      [principal.principal.id]
    );
    expect(parseInt(rows[0]!.count, 10)).toBe(1);
  });
});
