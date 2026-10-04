/**
 * Playwright API/E2E: request-body hardening.
 *
 * A malformed or empty JSON body must produce the route's intended 400 refusal,
 * never an unhandled 500 from a bare JSON.parse. This is the regression guard for
 * the class of defect reported in issue #66, applied to every body-reading route.
 */

import { expect, test, APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function guestToken(request: APIRequestContext): Promise<string> {
  const response = await request.post('/api/auth/guest', {
    data: { displayName: `Body Hardening E2E ${randomUUID()}` },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { sessionToken: string }).sessionToken;
}

const BODY_ROUTES = [
  { path: '/api/keys', method: 'post' as const },
  { path: '/api/files/upload', method: 'post' as const },
  { path: '/api/workspaces/shares', method: 'post' as const },
  { path: '/api/jobs', method: 'post' as const },
];

test.describe('Request body hardening', () => {
  test('malformed and empty JSON bodies are clean 400s, never 500s', async ({ request }) => {
    const token = await guestToken(request);
    const headers = { ...bearer(token), 'Content-Type': 'application/json' };

    for (const route of BODY_ROUTES) {
      const malformed = await request[route.method](route.path, {
        headers,
        data: '{ not json',
      });
      expect(malformed.status(), `${route.path} malformed`).toBe(400);

      const empty = await request[route.method](route.path, {
        headers,
        data: {},
      });
      expect(empty.status(), `${route.path} empty`).toBe(400);
    }
  });
});
