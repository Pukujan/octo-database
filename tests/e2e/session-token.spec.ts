/**
 * Playwright E2E: signed session tokens and share-response hygiene (ISS-1/ISS-2).
 *
 * ISS-1: a bearer session token is an HMAC-signed, expiring envelope, not a raw
 * principal UUID. The raw UUID is a public identifier (it also rode in media
 * query strings), so accepting it as a credential let anyone who observed it act
 * as that principal.
 *
 * ISS-2: the share create/list responses no longer echo the creator's principal id.
 */

import { expect, test, APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { signSessionToken } from '../../src/lib/session-token';

// The server is launched by playwright.config's webServer with this secret; the
// test process must sign under the same one to exercise a valid signature.
process.env['OCTO_SESSION_SECRET'] ??= 'e2e-session-secret';

interface GuestSession {
  principal: { id: string };
  workspace: { id: string };
  sessionToken: string;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createGuest(request: APIRequestContext): Promise<GuestSession> {
  const response = await request.post('/api/auth/guest', {
    data: { displayName: `Session E2E ${randomUUID()}` },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as GuestSession;
}

test.describe('signed session tokens (ISS-1)', () => {
  test('guest login mints a signed token, and the raw principal id is not a credential', async ({
    request,
  }) => {
    const guest = await createGuest(request);
    expect(guest.sessionToken.startsWith('octo_sess_')).toBe(true);
    expect(guest.sessionToken).not.toBe(guest.principal.id);

    // The raw principal UUID no longer authenticates.
    const raw = await request.get('/api/me', { headers: bearer(guest.principal.id) });
    expect(raw.status()).toBe(401);

    // The signed token does, and resolves to the same principal.
    const signed = await request.get('/api/me', { headers: bearer(guest.sessionToken) });
    expect(signed.status()).toBe(200);
    const body = (await signed.json()) as { principal: { id: string } };
    expect(body.principal.id).toBe(guest.principal.id);
  });

  test('a tampered signature is refused', async ({ request }) => {
    const guest = await createGuest(request);
    const flipped =
      guest.sessionToken.slice(0, -1) + (guest.sessionToken.endsWith('A') ? 'B' : 'A');
    const response = await request.get('/api/me', { headers: bearer(flipped) });
    expect(response.status()).toBe(401);
  });

  test('an expired token is refused', async ({ request }) => {
    const guest = await createGuest(request);
    const expired = signSessionToken(guest.principal.id, -1);
    const response = await request.get('/api/me', { headers: bearer(expired) });
    expect(response.status()).toBe(401);
  });
});

test.describe('share responses omit the creator id (ISS-2)', () => {
  test('create and list responses carry no createdBy and no principal id', async ({ request }) => {
    const guest = await createGuest(request);
    const workspaceId = guest.workspace.id;

    const created = await request.post('/api/workspaces/shares', {
      headers: bearer(guest.sessionToken),
      data: { workspaceId, resourceType: 'gallery', permission: 'read' },
    });
    expect(created.status()).toBe(201);
    const createdBody = await created.text();
    expect(createdBody).not.toContain('createdBy');
    expect(createdBody).not.toContain(guest.principal.id);

    const listed = await request.get(`/api/workspaces/shares?workspaceId=${workspaceId}`, {
      headers: bearer(guest.sessionToken),
    });
    expect(listed.status()).toBe(200);
    const listedBody = await listed.text();
    expect(listedBody).not.toContain('createdBy');
    expect(listedBody).not.toContain(guest.principal.id);
  });
});
