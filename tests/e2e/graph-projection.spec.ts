/**
 * Playwright E2E: the rebuildable workspace-graph projection (issue #12, slice E).
 *
 * PostgreSQL stays canonical; the graph is a read model. The properties that matter:
 *   - the fence is checked before the provider, so an unauthorized caller is refused
 *     whether or not FalkorDB is up (these run everywhere);
 *   - a rebuild from the same canonical rows yields the same graph, and a rebuild
 *     after new rows reflects them (needs a live engine, so it is skipped where none
 *     is present, exactly as graph-read.spec.ts skips).
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

const T1 = '2026-06-01T00:00:00.000Z';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createGuest(request: APIRequestContext): Promise<GuestSession> {
  const response = await request.post('/api/auth/guest', {
    data: { displayName: `Graph Projection E2E ${randomUUID()}` },
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
    data: { name: `graph projection key ${randomUUID()}`, workspaceId, scopes, confirmSecret: CONFIRM_SECRET },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as MintedKey;
}

async function record(
  request: APIRequestContext,
  token: string,
  body: Record<string, unknown>
): Promise<Record<string, any>> {
  const response = await request.post('/api/epistemic/record', {
    headers: bearer(token),
    data: body,
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json()) as Record<string, any>;
}

function project(request: APIRequestContext, token: string, workspaceId: string) {
  return request.post('/api/graph/project', { headers: bearer(token), data: { workspaceId } });
}

function queryGraph(request: APIRequestContext, token: string, workspaceId: string, query: string) {
  return request.post('/api/graph/query', {
    headers: bearer(token),
    data: { workspaceId, query },
  });
}

function health(request: APIRequestContext, token: string, workspaceId: string) {
  return request.get(`/api/graph/health?workspaceId=${workspaceId}`, { headers: bearer(token) });
}

test.describe('Rebuildable workspace-graph projection', () => {
  test('the fence is checked before the provider for project and health', async ({ request }) => {
    const owner = await createGuest(request);
    const stranger = await createGuest(request);
    const ws = owner.workspace.id;

    // Unauthenticated is refused on both routes.
    const anonProject = await request.post('/api/graph/project', { data: { workspaceId: ws } });
    expect(anonProject.status()).toBe(401);
    const anonHealth = await request.get(`/api/graph/health?workspaceId=${ws}`);
    expect(anonHealth.status()).toBe(401);

    // A read-only key cannot project (write scope required).
    const readKey = await mintKey(request, owner.sessionToken, ws, ['read']);
    const readProject = await project(request, readKey.rawSecret, ws);
    expect(readProject.status()).toBe(403);
    expect((await readProject.json()).error).toMatch(/scope/);

    // A workspace-scoped key cannot name another workspace.
    const writeKey = await mintKey(request, owner.sessionToken, ws, ['read', 'write']);
    const crossProject = await project(request, writeKey.rawSecret, stranger.workspace.id);
    expect(crossProject.status()).toBe(403);
    expect((await crossProject.json()).error).toMatch(/Key restricted to different workspace/);

    // A malformed workspace id is a clean 400, never a 500.
    const malformed = await project(request, writeKey.rawSecret, 'not-a-uuid');
    expect(malformed.status()).toBe(400);

    // A stranger is refused the owner's workspace by membership.
    const strangerHealth = await health(request, stranger.sessionToken, ws);
    expect(strangerHealth.status()).toBe(403);
  });

  test('a read key discovers graph.health and graph.query; a write key also discovers graph.project', async ({
    request,
  }) => {
    const owner = await createGuest(request);
    const ws = owner.workspace.id;

    const readKey = await mintKey(request, owner.sessionToken, ws, ['read']);
    const readDiscovery = await request.get(`/api/capabilities?workspaceId=${ws}`, {
      headers: bearer(readKey.rawSecret),
    });
    expect(readDiscovery.status()).toBe(200);
    const readActions = new Set(
      ((await readDiscovery.json()) as { capabilities: Array<{ action: string }> }).capabilities.map(
        (c) => c.action
      )
    );
    expect(readActions.has('graph.health')).toBe(true);
    expect(readActions.has('graph.query')).toBe(true);
    // The read-only key lacks the write scope, so the project action is absent.
    expect(readActions.has('graph.project')).toBe(false);

    const writeKey = await mintKey(request, owner.sessionToken, ws, ['read', 'write']);
    const writeDiscovery = await request.get(`/api/capabilities?workspaceId=${ws}`, {
      headers: bearer(writeKey.rawSecret),
    });
    const writeActions = new Set(
      ((await writeDiscovery.json()) as { capabilities: Array<{ action: string }> }).capabilities.map(
        (c) => c.action
      )
    );
    expect(writeActions.has('graph.project')).toBe(true);
  });

  test('a rebuild reflects canonical rows and converges: delete-and-rebuild is equivalent', async ({
    request,
  }) => {
    const owner = await createGuest(request);
    const key = await mintKey(request, owner.sessionToken, owner.workspace.id, ['read', 'write']);
    const token = key.rawSecret;
    const ws = owner.workspace.id;

    // Without an engine the projection fails closed; skip the configured-path eval.
    const probe = await project(request, token, ws);
    test.skip(probe.status() === 503, 'A FalkorDB engine is required for the projection eval');
    expect(probe.status()).toBe(200);

    // --- canonical ledger ------------------------------------------------------
    const entity = await record(request, token, {
      workspaceId: ws,
      kind: 'entity',
      name: `Policy ${randomUUID()}`,
      entityType: 'policy',
    });
    const perspective = await record(request, token, {
      workspaceId: ws,
      kind: 'perspective',
      name: `Analyst ${randomUUID()}`,
    });
    const claim = await record(request, token, {
      workspaceId: ws,
      kind: 'claim',
      subjectEntityId: entity.entity.id,
      statement: 'The policy reduces emissions by 30% by 2030.',
      validFrom: T1,
      recordedAt: T1,
      provenance: { run: 'run-1' },
    });
    await record(request, token, {
      workspaceId: ws,
      kind: 'belief',
      perspectiveId: perspective.perspective.id,
      claimId: claim.claim.id,
      stance: 'believes',
      confidence: 0.9,
      validFrom: T1,
      recordedAt: T1,
    });

    // --- project, then read the projected shape back ---------------------------
    const first = await project(request, token, ws);
    expect(first.status()).toBe(200);
    const firstBody = (await first.json()) as any;
    expect(firstBody.claimCount).toBe(1);
    expect(firstBody.entityCount).toBe(1);

    const claimCount = async () => {
      const response = await queryGraph(request, token, ws, 'MATCH (c:Claim) RETURN count(c) AS n');
      expect(response.status()).toBe(200);
      const rows = ((await response.json()) as any).rows as Array<{ n: number }>;
      return Number(rows[0]?.n);
    };
    const beliefEdges = async () => {
      const response = await queryGraph(
        request,
        token,
        ws,
        'MATCH (b:Belief)-[:HELD_BY]->(p:Perspective) RETURN count(b) AS n'
      );
      expect(response.status()).toBe(200);
      const rows = ((await response.json()) as any).rows as Array<{ n: number }>;
      return Number(rows[0]?.n);
    };

    expect(await claimCount()).toBe(1);
    expect(await beliefEdges()).toBe(1);

    // The projected claim carries its canonical statement and provenance. Provenance
    // travels as its JSON encoding, since graph properties hold only primitives.
    const statementQuery = await queryGraph(
      request,
      token,
      ws,
      'MATCH (c:Claim) RETURN c.statement AS statement, c.provenance AS provenance'
    );
    const statementRows = ((await statementQuery.json()) as any).rows as Array<{
      statement: string;
      provenance: string;
    }>;
    expect(statementRows[0]?.statement).toBe('The policy reduces emissions by 30% by 2030.');
    expect(JSON.parse(statementRows[0]?.provenance ?? '{}')).toMatchObject({ run: 'run-1' });

    // --- rebuild: destroy-and-rebuild converges to the same graph --------------
    const rebuild = await project(request, token, ws);
    expect(rebuild.status()).toBe(200);
    expect(await claimCount()).toBe(1);
    expect(await beliefEdges()).toBe(1);

    // --- new canonical rows are reflected by the next rebuild ------------------
    await record(request, token, {
      workspaceId: ws,
      kind: 'claim',
      subjectEntityId: entity.entity.id,
      statement: 'A second claim appears.',
      validFrom: T1,
      recordedAt: T1,
    });
    const rebuildAfter = await project(request, token, ws);
    expect(rebuildAfter.status()).toBe(200);
    expect(await claimCount()).toBe(2);

    // --- health reports the projection and staleness ---------------------------
    const fresh = await health(request, token, ws);
    expect(fresh.status()).toBe(200);
    const freshBody = (await fresh.json()) as any;
    expect(freshBody.configured).toBe(true);
    expect(freshBody.stale).toBe(false);
    expect(freshBody.projection.claimCount).toBe(2);

    // Recording a new claim moves the canonical ledger past the watermark. Its
    // recorded instant defaults to now(), so the watermark advances beyond the
    // instant the last projection was built from.
    await record(request, token, {
      workspaceId: ws,
      kind: 'claim',
      statement: 'Recorded after the last projection.',
      validFrom: T1,
    });
    const staleHealth = await health(request, token, ws);
    expect(staleHealth.status()).toBe(200);
    expect(((await staleHealth.json()) as any).stale).toBe(true);
  });
});
