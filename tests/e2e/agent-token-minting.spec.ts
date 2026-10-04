/**
 * Playwright API/E2E: key-minting authority (no privilege escalation).
 *
 * A token may only narrow its own authority when minting another key. These
 * cases exercise the HTTP route end to end: a workspace-bound token must not be
 * able to escape its binding or mint an account-wide key, a token must not grant
 * scopes it does not hold, and a malformed body must be a clean 400, never a 500.
 */

import { expect, test, APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

interface GuestSession {
  principal: { id: string; isGuest: boolean };
  workspace: { id: string; slug: string; role: string };
  sessionToken: string;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createGuest(request: APIRequestContext): Promise<GuestSession> {
  const response = await request.post('/api/auth/guest', {
    data: { displayName: `Key Mint E2E ${randomUUID()}` },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as GuestSession;
}

async function mintKey(
  request: APIRequestContext,
  token: string,
  body: Record<string, unknown>
): Promise<{ status: number; rawSecret?: string; apiKey?: { id: string } }> {
  const response = await request.post('/api/keys', { headers: bearer(token), data: body });
  const payload = (await response.json().catch(() => ({}))) as {
    rawSecret?: string;
    apiKey?: { id: string };
  };
  return { status: response.status(), ...payload };
}

test.describe('Agent token minting authority', () => {
  test('a workspace-bound token cannot mint an account-wide or cross-workspace key, nor widen scopes', async ({
    request,
  }) => {
    const owner = await createGuest(request);

    const otherResponse = await request.post('/api/workspaces', {
      headers: bearer(owner.sessionToken),
      data: { name: `Key Mint Other ${randomUUID()}` },
    });
    expect(otherResponse.status()).toBe(201);
    const otherWorkspace = (await otherResponse.json()).workspace as { id: string };

    // A read-only workspace token cannot mint anything at all.
    const readOnly = await mintKey(request, owner.sessionToken, {
      name: `read-only ${randomUUID()}`,
      workspaceId: owner.workspace.id,
      scopes: ['read', 'files'],
    });
    expect(readOnly.status).toBe(201);
    const readOnlyAttempt = await mintKey(request, readOnly.rawSecret!, {
      name: `escalation ${randomUUID()}`,
      scopes: ['read'],
    });
    expect(readOnlyAttempt.status).toBe(403);

    // A workspace-bound write token still cannot escape its binding.
    const writer = await mintKey(request, owner.sessionToken, {
      name: `writer ${randomUUID()}`,
      workspaceId: owner.workspace.id,
      scopes: ['read', 'write', 'files'],
    });
    expect(writer.status).toBe(201);

    const accountWideEscape = await mintKey(request, writer.rawSecret!, {
      name: `account escape ${randomUUID()}`,
      scopes: ['read'],
    });
    expect(accountWideEscape.status).toBe(403);

    const crossWorkspaceEscape = await mintKey(request, writer.rawSecret!, {
      name: `cross escape ${randomUUID()}`,
      workspaceId: otherWorkspace.id,
      scopes: ['read'],
    });
    expect(crossWorkspaceEscape.status).toBe(403);

    const scopeWidening = await mintKey(request, writer.rawSecret!, {
      name: `widen ${randomUUID()}`,
      workspaceId: owner.workspace.id,
      scopes: ['read', 'write', 'files', 'delete'],
    });
    expect(scopeWidening.status).toBe(403);

    // Narrowing within its own workspace is allowed.
    const narrowed = await mintKey(request, writer.rawSecret!, {
      name: `narrowed ${randomUUID()}`,
      workspaceId: owner.workspace.id,
      scopes: ['read', 'files'],
    });
    expect(narrowed.status).toBe(201);

    // No account-wide key was ever created for this principal.
    const keysResponse = await request.get('/api/keys', { headers: bearer(owner.sessionToken) });
    expect(keysResponse.status()).toBe(200);
    const keys = (await keysResponse.json()) as Array<{ workspaceId: string | null }>;
    expect(keys.some((key) => key.workspaceId === null)).toBe(false);

    // A malformed or empty body is a clean 400, never an unhandled 500.
    const malformed = await request.post('/api/keys', {
      headers: { ...bearer(owner.sessionToken), 'Content-Type': 'application/json' },
      data: '{ not json',
    });
    expect(malformed.status()).toBe(400);

    const empty = await request.post('/api/keys', {
      headers: bearer(owner.sessionToken),
      data: {},
    });
    expect(empty.status()).toBe(400);
  });
});
