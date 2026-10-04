/**
 * Playwright API/E2E: route input hardening beyond the JSON-object routes.
 *
 * Two shapes slipped past the generic body-hardening guard because they do not go
 * through `readJsonObject`:
 *   * `POST /api/auth/guest` parsed its body with a bare `JSON.parse`, so a
 *     malformed or `null` body reached `.displayName` and threw — a 500 with the
 *     parser/TypeError text for what is an anonymous, bodyless-friendly endpoint.
 *   * `POST /api/keys` accepted any positive integer `expiresInDays`, so a value
 *     large enough to overflow the Date range threw `Invalid time value` — a 500
 *     for a client-supplied number.
 *
 * Neither is a mutation risk; the defect is a wrong status and a leaked internal
 * message. This asserts both are clean refusals/successes, never a 5xx.
 */

import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const JSON_HEADERS = { 'Content-Type': 'application/json' };

test.describe('Route input hardening', () => {
  test('the guest route tolerates a malformed, empty, null, or non-object body', async ({
    request,
  }) => {
    const bodies = ['{ not json', '', 'null', '[]', '"a string"'];
    for (const data of bodies) {
      const response = await request.post('/api/auth/guest', {
        headers: { ...JSON_HEADERS, 'X-Probe': randomUUID() },
        data,
      });
      expect(response.status(), `guest body ${JSON.stringify(data)}`).toBeLessThan(500);
      if (response.status() === 201) {
        const body = (await response.json()) as { sessionToken?: string; principal?: unknown };
        expect(body.sessionToken, 'a created guest carries a session token').toBeTruthy();
        expect(body.principal, 'a created guest carries a principal').toBeTruthy();
      }
    }
  });

  test('an out-of-range key expiry is a clean 400, never a 500', async ({ request }) => {
    const guest = await request.post('/api/auth/guest', { headers: JSON_HEADERS, data: {} });
    expect(guest.status()).toBe(201);
    const { sessionToken, workspace } = (await guest.json()) as {
      sessionToken: string;
      workspace: { id: string };
    };

    for (const expiresInDays of [100000000000, Number.MAX_SAFE_INTEGER]) {
      const response = await request.post('/api/keys', {
        headers: { ...bearer(sessionToken), ...JSON_HEADERS },
        data: { name: `Overflow ${randomUUID()}`, expiresInDays },
      });
      expect(response.status(), `expiresInDays ${expiresInDays}`).toBe(400);
      const body = JSON.stringify(await response.json());
      expect(body, 'leaked internal detail').not.toMatch(/Invalid time value|INTERNAL_SERVER_ERROR/i);
    }

    // The share route builds an expiry from hours the same way and had the same
    // overflow hole.
    for (const expiresInHours of [1e15, Number.MAX_SAFE_INTEGER]) {
      const response = await request.post('/api/workspaces/shares', {
        headers: { ...bearer(sessionToken), ...JSON_HEADERS },
        data: { workspaceId: workspace.id, resourceType: 'gallery', permission: 'read', expiresInHours },
      });
      expect(response.status(), `expiresInHours ${expiresInHours}`).toBe(400);
      const body = JSON.stringify(await response.json());
      expect(body, 'leaked internal detail').not.toMatch(/Invalid time value|INTERNAL_SERVER_ERROR/i);
    }
  });
});
