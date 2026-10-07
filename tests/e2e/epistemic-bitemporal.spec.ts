/**
 * Playwright E2E: the epistemic record/query API (issue #11, slice 9).
 *
 * Pins the acceptance oracle for one policy narrative:
 *   - claim A is recorded as believed at T1;
 *   - later evidence contradicts it at T2, and perspective A stops believing it;
 *   - a new claim supersedes it at T3;
 *   - query 1 answers "what did perspective P believe at T2?";
 *   - query 2 answers "with current knowledge, what do we now consider valid at T2?";
 *   - the two answers differ correctly and cite evidence/provenance;
 *   - another perspective holds a different belief about the same claim.
 *
 * The schema is canonical in PostgreSQL; these routes are the only way an agent
 * writes to it. History is append-only: nothing here deletes or rewrites a row.
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
const T2 = '2026-06-15T00:00:00.000Z';
const T3 = '2026-07-01T00:00:00.000Z';
const AFTER_T3 = '2026-08-01T00:00:00.000Z';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createGuest(request: APIRequestContext): Promise<GuestSession> {
  const response = await request.post('/api/auth/guest', {
    data: { displayName: `Epistemic E2E ${randomUUID()}` },
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
    data: { name: `epistemic key ${randomUUID()}`, workspaceId, scopes, confirmSecret: CONFIRM_SECRET },
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

test.describe('Epistemic bitemporal record and query', () => {
  test('the T1/T2/T3 policy oracle: both query modes differ correctly and cite provenance', async ({
    request,
  }) => {
    const owner = await createGuest(request);
    const key = await mintKey(request, owner.sessionToken, owner.workspace.id, ['read', 'write']);
    const token = key.rawSecret;
    const ws = owner.workspace.id;

    // --- T1: the world as first recorded -------------------------------------
    const entity = await record(request, token, {
      workspaceId: ws,
      kind: 'entity',
      name: `Policy ${randomUUID()}`,
      entityType: 'policy',
    });
    const analystA = await record(request, token, {
      workspaceId: ws,
      kind: 'perspective',
      name: `Analyst A ${randomUUID()}`,
    });
    const analystB = await record(request, token, {
      workspaceId: ws,
      kind: 'perspective',
      name: `Analyst B ${randomUUID()}`,
    });

    const claimA = await record(request, token, {
      workspaceId: ws,
      kind: 'claim',
      subjectEntityId: entity.entity.id,
      statement: 'The policy reduces emissions by 30% by 2030.',
      validFrom: T1,
      recordedAt: T1,
      provenance: { run: 'run-1', source: 'draft-v1' },
    });

    const evidence = await record(request, token, {
      workspaceId: ws,
      kind: 'evidence',
      quote: 'Revised modelling shows a 12% reduction.',
      locator: 'section 4.2',
      contentHash: 'hash-of-revised-model',
    });
    await record(request, token, {
      workspaceId: ws,
      kind: 'claim_evidence',
      claimId: claimA.claim.id,
      evidenceId: evidence.evidence.id,
      stance: 'contradicts',
    });

    // Analyst A believed it at T1; analyst B was only uncertain.
    await record(request, token, {
      workspaceId: ws,
      kind: 'belief',
      perspectiveId: analystA.perspective.id,
      claimId: claimA.claim.id,
      stance: 'believes',
      confidence: 0.9,
      validFrom: T1,
      recordedAt: T1,
    });
    await record(request, token, {
      workspaceId: ws,
      kind: 'belief',
      perspectiveId: analystB.perspective.id,
      claimId: claimA.claim.id,
      stance: 'uncertain',
      confidence: 0.4,
      validFrom: T1,
      recordedAt: T1,
    });

    // --- T2: the contradicting evidence lands; analyst A stops believing ------
    await record(request, token, {
      workspaceId: ws,
      kind: 'belief',
      perspectiveId: analystA.perspective.id,
      claimId: claimA.claim.id,
      stance: 'disbelieves',
      confidence: 0.85,
      validFrom: T1,
      recordedAt: T2,
    });

    // --- T3: a corrected claim supersedes the original ------------------------
    const claimB = await record(request, token, {
      workspaceId: ws,
      kind: 'claim',
      subjectEntityId: entity.entity.id,
      statement: 'The policy reduces emissions by 12% by 2030.',
      validFrom: T2,
      recordedAt: T3,
      supersedesClaimId: claimA.claim.id,
      provenance: { run: 'run-3', source: 'revised-model' },
    });
    expect(claimB.claim.supersededClaimId).toBe(claimA.claim.id);

    // --- Query 1: what did analyst A believe at T2? ---------------------------
    const beliefAtT2 = await request.get(
      `/api/epistemic/belief-as-of?workspaceId=${ws}&perspectiveId=${analystA.perspective.id}` +
        `&claimId=${claimA.claim.id}&asOfRecorded=${T2}&asOfValid=${T2}`,
      { headers: bearer(token) }
    );
    expect(beliefAtT2.status()).toBe(200);
    const beliefBody = (await beliefAtT2.json()) as any;
    expect(beliefBody.belief).toMatchObject({ stance: 'disbelieves' });
    expect(Number(beliefBody.belief.confidence)).toBeCloseTo(0.85, 3);
    // The answer cites the contradicting evidence.
    expect(beliefBody.evidence).toHaveLength(1);
    expect(beliefBody.evidence[0]).toMatchObject({
      evidenceId: evidence.evidence.id,
      stance: 'contradicts',
      contentHash: 'hash-of-revised-model',
    });

    // At T1 the same perspective believed it -- history is preserved, not overwritten.
    const beliefAtT1 = await request.get(
      `/api/epistemic/belief-as-of?workspaceId=${ws}&perspectiveId=${analystA.perspective.id}` +
        `&claimId=${claimA.claim.id}&asOfRecorded=${T1}&asOfValid=${T1}`,
      { headers: bearer(token) }
    );
    expect(beliefAtT1.status()).toBe(200);
    expect((await beliefAtT1.json()).belief).toMatchObject({ stance: 'believes' });

    // A different perspective holds a different belief about the same claim at T2.
    const beliefBAtT2 = await request.get(
      `/api/epistemic/belief-as-of?workspaceId=${ws}&perspectiveId=${analystB.perspective.id}` +
        `&claimId=${claimA.claim.id}&asOfRecorded=${T2}&asOfValid=${T2}`,
      { headers: bearer(token) }
    );
    expect(beliefBAtT2.status()).toBe(200);
    expect((await beliefBAtT2.json()).belief).toMatchObject({ stance: 'uncertain' });

    // --- Query 2: with current knowledge, what do we now consider valid at T2? -
    const nowValidAtT2 = await request.get(
      `/api/epistemic/claims-as-of?workspaceId=${ws}&asOfRecorded=${AFTER_T3}&asOfValid=${T2}`,
      { headers: bearer(token) }
    );
    expect(nowValidAtT2.status()).toBe(200);
    const nowBody = (await nowValidAtT2.json()) as any;
    const nowStatements = nowBody.claims.map((c: any) => c.statement);
    expect(nowStatements).toContain('The policy reduces emissions by 12% by 2030.');
    expect(nowStatements).not.toContain('The policy reduces emissions by 30% by 2030.');
    // Provenance travels with the claim.
    expect(nowBody.claims[0].provenance).toMatchObject({ run: 'run-3' });

    // At T2 (before the correction was recorded) only the original claim was known.
    const asKnownAtT2 = await request.get(
      `/api/epistemic/claims-as-of?workspaceId=${ws}&asOfRecorded=${T2}&asOfValid=${T2}`,
      { headers: bearer(token) }
    );
    expect(asKnownAtT2.status()).toBe(200);
    const t2Statements = ((await asKnownAtT2.json()) as any).claims.map((c: any) => c.statement);
    expect(t2Statements).toEqual(['The policy reduces emissions by 30% by 2030.']);

    // The two query modes answer differently -- the recorded-time axis is what separates them.
    expect(nowStatements).not.toEqual(t2Statements);

    // History was appended to, never rewritten: the original claim still exists.
    const supersededCheck = await request.get(
      `/api/epistemic/claims-as-of?workspaceId=${ws}&asOfRecorded=${T1}&asOfValid=${T1}`,
      { headers: bearer(token) }
    );
    expect(((await supersededCheck.json()) as any).claims).toHaveLength(1);
  });

  test('authorization: unauthenticated, read-only, and cross-workspace callers are refused', async ({
    request,
  }) => {
    const owner = await createGuest(request);
    const stranger = await createGuest(request);
    const ws = owner.workspace.id;

    // Unauthenticated is refused.
    const anonymous = await request.post('/api/epistemic/record', {
      data: { workspaceId: ws, kind: 'entity', name: 'nope' },
    });
    expect(anonymous.status()).toBe(401);

    // A read-only key cannot write.
    const readKey = await mintKey(request, owner.sessionToken, ws, ['read']);
    const readWrite = await request.post('/api/epistemic/record', {
      headers: bearer(readKey.rawSecret),
      data: { workspaceId: ws, kind: 'entity', name: `read-only ${randomUUID()}` },
    });
    expect(readWrite.status()).toBe(403);
    expect((await readWrite.json()).error).toMatch(/scope/);

    // A workspace-scoped key cannot name another workspace.
    const writeKey = await mintKey(request, owner.sessionToken, ws, ['read', 'write']);
    const crossWorkspace = await request.post('/api/epistemic/record', {
      headers: bearer(writeKey.rawSecret),
      data: { workspaceId: stranger.workspace.id, kind: 'entity', name: 'cross' },
    });
    expect(crossWorkspace.status()).toBe(403);
    expect((await crossWorkspace.json()).error).toMatch(/Key restricted to different workspace/);

    // A stranger is refused the owner's workspace by membership.
    const strangerRead = await request.get(
      `/api/epistemic/claims-as-of?workspaceId=${ws}&asOfRecorded=${T1}`,
      { headers: bearer(stranger.sessionToken) }
    );
    expect(strangerRead.status()).toBe(403);

    // An unknown kind is a clean 400, never a 500.
    const badKind = await request.post('/api/epistemic/record', {
      headers: bearer(writeKey.rawSecret),
      data: { workspaceId: ws, kind: 'nonsense' },
    });
    expect(badKind.status()).toBe(400);
  });

  test('a read-scoped key discovers the epistemic capabilities; a member does not discover the write', async ({
    request,
  }) => {
    const owner = await createGuest(request);
    const readKey = await mintKey(request, owner.sessionToken, owner.workspace.id, ['read']);

    const discovery = await request.get(`/api/capabilities?workspaceId=${owner.workspace.id}`, {
      headers: bearer(readKey.rawSecret),
    });
    expect(discovery.status()).toBe(200);
    const payload = (await discovery.json()) as { capabilities: Array<{ action: string }> };
    const actions = new Set(payload.capabilities.map((c) => c.action));

    expect(actions.has('epistemic.claims_as_of')).toBe(true);
    expect(actions.has('epistemic.belief_as_of')).toBe(true);
    // The read-only key lacks the write scope, so the record action is absent.
    expect(actions.has('epistemic.record')).toBe(false);
  });
});
