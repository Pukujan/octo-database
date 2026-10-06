/**
 * Playwright E2E: operational event capture and read-back (issue #140, slice O1).
 *
 * The worker's fail path is the deterministic failure source: a thumbnail job
 * whose payload is missing its required fields fails permanently
 * (INVALID_PAYLOAD) without touching storage. Draining it must leave exactly one
 * queryable `ops_events` row, attributable to the right workspace, readable
 * through the fenced `GET /api/ops/events` route.
 *
 * The properties this slice claims: append-only (the same failure recorded twice
 * is two rows, never an upsert) and workspace isolation (a non-member cannot read
 * another workspace's events).
 */

import { expect, test, APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

interface GuestSession {
  principal: { id: string };
  workspace: { id: string };
  sessionToken: string;
}

interface OpsEvent {
  id: string;
  source: string;
  eventType: string;
  errorCode: string | null;
  severity: string;
  jobId: string | null;
  jobType: string | null;
  createdAt: string;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createGuest(request: APIRequestContext): Promise<GuestSession> {
  const response = await request.post('/api/auth/guest', {
    data: { displayName: `Ops E2E ${randomUUID()}` },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as GuestSession;
}

async function enqueueInvalidThumbnail(
  request: APIRequestContext,
  token: string,
  workspaceId: string
): Promise<string> {
  const response = await request.post('/api/jobs', {
    headers: bearer(token),
    data: {
      workspaceId,
      jobType: 'thumbnail',
      idempotencyKey: `ops-e2e-${randomUUID()}`,
      payload: {},
    },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { job: { id: string } };
  return body.job.id;
}

async function listEvents(
  request: APIRequestContext,
  token: string,
  workspaceId: string,
  errorCode?: string
): Promise<OpsEvent[]> {
  const query = new URLSearchParams({ workspaceId });
  if (errorCode) query.set('errorCode', errorCode);
  const response = await request.get(`/api/ops/events?${query.toString()}`, {
    headers: bearer(token),
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { events: OpsEvent[] }).events;
}

test.describe('Operational events (slice O1)', () => {
  test('a permanently-failed job leaves exactly one attributable, readable event', async ({
    request,
  }) => {
    const guest = await createGuest(request);
    const workspaceId = guest.workspace.id;
    const jobId = await enqueueInvalidThumbnail(request, guest.sessionToken, workspaceId);

    const run = await request.post(`/api/jobs/run?workspaceId=${workspaceId}`, {
      headers: bearer(guest.sessionToken),
    });
    expect(run.status()).toBe(200);
    const { outcomes } = (await run.json()) as { outcomes: { status: string; detail: string }[] };
    const failed = outcomes.find((o) => o.status === 'failed');
    expect(failed).toBeTruthy();
    expect(failed!.detail).toMatch(/fileId/);

    const events = await listEvents(request, guest.sessionToken, workspaceId, 'INVALID_PAYLOAD');
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event.source).toBe('worker');
    expect(event.eventType).toBe('job.failed');
    expect(event.severity).toBe('error');
    expect(event.jobId).toBe(jobId);
    expect(event.jobType).toBe('thumbnail');
  });

  test('capture is append-only: the same failure twice is two rows', async ({ request }) => {
    const guest = await createGuest(request);
    const workspaceId = guest.workspace.id;

    await enqueueInvalidThumbnail(request, guest.sessionToken, workspaceId);
    await enqueueInvalidThumbnail(request, guest.sessionToken, workspaceId);
    await request.post(`/api/jobs/run?workspaceId=${workspaceId}`, {
      headers: bearer(guest.sessionToken),
    });

    const events = await listEvents(request, guest.sessionToken, workspaceId, 'INVALID_PAYLOAD');
    expect(events).toHaveLength(2);
    expect(events[0].id).not.toBe(events[1].id);
  });

  test('the read route filters by error code', async ({ request }) => {
    const guest = await createGuest(request);
    const workspaceId = guest.workspace.id;
    await enqueueInvalidThumbnail(request, guest.sessionToken, workspaceId);
    await request.post(`/api/jobs/run?workspaceId=${workspaceId}`, {
      headers: bearer(guest.sessionToken),
    });

    expect(await listEvents(request, guest.sessionToken, workspaceId, 'INVALID_PAYLOAD')).toHaveLength(1);
    expect(await listEvents(request, guest.sessionToken, workspaceId, 'NO_SUCH_CODE')).toHaveLength(0);
  });

  test('events are not readable across workspaces or anonymously', async ({ request }) => {
    const guestA = await createGuest(request);
    const guestB = await createGuest(request);
    await enqueueInvalidThumbnail(request, guestA.sessionToken, guestA.workspace.id);
    await request.post(`/api/jobs/run?workspaceId=${guestA.workspace.id}`, {
      headers: bearer(guestA.sessionToken),
    });

    const crossWorkspace = await request.get(
      `/api/ops/events?workspaceId=${guestA.workspace.id}`,
      { headers: bearer(guestB.sessionToken) }
    );
    expect(crossWorkspace.status()).toBe(403);

    const anonymous = await request.get(`/api/ops/events?workspaceId=${guestA.workspace.id}`);
    expect(anonymous.status()).toBe(401);
  });
});
