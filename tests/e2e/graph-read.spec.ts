/**
 * Playwright E2E: the mediated workspace-graph read (issue #12, slice C).
 *
 * The graph engine inherits none of the octo.* RLS fence, so the only thing
 * preventing a cross-workspace graph read is this route. These tests pin the
 * properties that hold without a running engine -- the fence is checked before the
 * provider, so an unauthorized caller is refused whether or not FalkorDB is up.
 * The configured path needs a live engine, so it is skipped where none is present
 * (CI), exactly as the archive eval skips without Drive.
 */

import { expect, test, APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { CONFIRM_SECRET, setConfirmSecret } from './confirm-secret';

interface GuestSession {
  principal: { id: string; isGuest: boolean };
  workspace: { id: string; slug: string; role: string };
  sessionToken: string;
}

interface MintedKey {
  apiKey: { id: string; workspaceId: string | null; scopes: string[] };
  rawSecret: string;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createGuest(request: APIRequestContext): Promise<GuestSession> {
  const response = await request.post('/api/auth/guest', {
    data: { displayName: `Graph E2E ${randomUUID()}` },
  });
  expect(response.status()).toBe(201);
  const session = (await response.json()) as GuestSession;
  await setConfirmSecret(request, session.sessionToken);
  return session;
}

async function mintKey(
  request: APIRequestContext,
  sessionToken: string,
  workspaceId: string,
  scopes: string[]
): Promise<MintedKey> {
  const response = await request.post('/api/keys', {
    headers: bearer(sessionToken),
    data: { name: `graph key ${randomUUID()}`, workspaceId, scopes, confirmSecret: CONFIRM_SECRET },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as MintedKey;
}

function graphQuery(request: APIRequestContext, token: string, workspaceId: string, query: string) {
  return request.post('/api/graph/query', {
    headers: bearer(token),
    data: { workspaceId, query },
  });
}

test.describe('Mediated workspace-graph read', () => {
  test('unauthenticated callers are refused', async ({ request }) => {
    const response = await request.post('/api/graph/query', {
      data: { workspaceId: randomUUID(), query: 'MATCH (n) RETURN n' },
    });
    expect(response.status()).toBe(401);
  });

  test('a workspace key cannot read another workspace, and a non-member is refused', async ({
    request,
  }) => {
    const owner = await createGuest(request);
    const stranger = await createGuest(request);
    const key = await mintKey(request, owner.sessionToken, owner.workspace.id, ['read']);

    // The key is pinned to its own workspace: naming another workspace is refused
    // before the engine is ever consulted.
    const crossKey = await graphQuery(request, key.rawSecret, stranger.workspace.id, 'MATCH (n) RETURN n');
    expect(crossKey.status()).toBe(403);
    expect((await crossKey.json()).error).toMatch(/Key restricted to different workspace/);

    // A member of another workspace, using its own session, is refused the owner's
    // workspace by membership rather than by the engine.
    const crossMember = await graphQuery(
      request,
      stranger.sessionToken,
      owner.workspace.id,
      'MATCH (n) RETURN n'
    );
    expect(crossMember.status()).toBe(403);
    expect((await crossMember.json()).error).toMatch(/Not a member of this workspace/);

    // A malformed workspace id is refused as a clean 400, never a 500.
    const malformed = await graphQuery(request, key.rawSecret, 'not-a-uuid', 'MATCH (n) RETURN n');
    expect(malformed.status()).toBe(400);
  });

  test('a read-scoped key discovers graph.query; an unconfigured engine fails closed', async ({
    request,
  }) => {
    const owner = await createGuest(request);
    const key = await mintKey(request, owner.sessionToken, owner.workspace.id, ['read']);
    const keyHeaders = bearer(key.rawSecret);

    const discovery = await request.get(`/api/capabilities?workspaceId=${owner.workspace.id}`, {
      headers: keyHeaders,
    });
    expect(discovery.status()).toBe(200);
    const payload = (await discovery.json()) as {
      capabilities: Array<{ action: string }>;
      unavailable: Array<{ action: string; reason: string }>;
    };
    const actions = new Set(payload.capabilities.map((capability) => capability.action));
    const unavailable = new Set(payload.unavailable.map((entry) => entry.action));

    const graphUnavailable = unavailable.has('graph.query');
    test.skip(!graphUnavailable, 'A FalkorDB engine is configured in this test environment');

    // Unconfigured: the action is advertised as unavailable, not silently offered.
    expect(actions.has('graph.query')).toBe(false);

    const refused = await graphQuery(request, key.rawSecret, owner.workspace.id, 'MATCH (n) RETURN n');
    expect(refused.status()).toBe(503);
    expect((await refused.json()).error).toMatch(/GRAPH_NOT_CONFIGURED/);
  });

  test('the graph engine answers a read-only query when configured', async ({ request }) => {
    const owner = await createGuest(request);
    const key = await mintKey(request, owner.sessionToken, owner.workspace.id, ['read']);

    const probe = await graphQuery(request, key.rawSecret, owner.workspace.id, 'MATCH (n) RETURN n');
    test.skip(
      probe.status() === 503,
      'A FalkorDB engine is required for the configured-path eval'
    );

    // The workspace's graph has not been projected yet (that is slice E), so the
    // read reaches the engine and returns an empty result -- not an error.
    expect(probe.status()).toBe(200);
    const body = (await probe.json()) as { rows: unknown[]; metadata: unknown[] };
    expect(body.rows).toEqual([]);
    expect(Array.isArray(body.metadata)).toBe(true);
  });
});
