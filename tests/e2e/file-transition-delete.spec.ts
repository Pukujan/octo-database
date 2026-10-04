/** File deletion is serialized with queued and running archive/restore work. */

import { randomUUID } from 'node:crypto';
import { expect, test, APIRequestContext } from '@playwright/test';
import { dbEnqueueFileTransition, queryService } from '../../src/server/db';

async function createFileFixture(request: APIRequestContext) {
  const guestResponse = await request.post('/api/auth/guest', {
    data: { displayName: `File transition ${randomUUID()}` },
  });
  expect(guestResponse.status()).toBe(201);
  const guest = (await guestResponse.json()) as {
    sessionToken: string;
    principal: { id: string };
    workspace: { id: string };
  };

  const upload = await request.post('/api/files/upload', {
    headers: { Authorization: `Bearer ${guest.sessionToken}` },
    data: {
      workspaceId: guest.workspace.id,
      name: `transition-${randomUUID()}.txt`,
      mimeType: 'text/plain',
      data: randomUUID(),
      dataEncoding: 'utf8',
    },
  });
  expect(upload.status()).toBe(201);
  const file = (await upload.json()) as { id: string };
  return { ...guest, file };
}

for (const { direction, state } of [
  { direction: 'archive', state: 'queued' },
  { direction: 'archive', state: 'running' },
  { direction: 'restore', state: 'queued' },
  { direction: 'restore', state: 'running' },
] as const) {
  test(`blocks deletion during ${direction} transition in ${state}`, async ({ request }) => {
    const fixture = await createFileFixture(request);
    const queued = await dbEnqueueFileTransition(
      randomUUID(),
      fixture.workspace.id,
      direction,
      `${direction}:${fixture.file.id}`,
      { fileId: fixture.file.id, storageKey: `test/${fixture.file.id}`, mimeType: 'text/plain' },
      fixture.principal.id
    );
    expect(queued.status).toBe('queued');
    if (queued.status !== 'queued') return;
    const jobId = queued.job.id;
    if (state === 'running') {
      await queryService("UPDATE octo.jobs SET state = 'running' WHERE id = $1", [jobId]);
    }

    const headers = { Authorization: `Bearer ${fixture.sessionToken}` };
    const url = `/api/files/${fixture.file.id}?workspaceId=${fixture.workspace.id}`;
    const refused = await request.delete(url, { headers });
    expect(refused.status()).toBe(409);
    expect((await refused.json()).error).toContain('FILE_BUSY');

    const stillPresent = await queryService<{ id: string }>(
      'SELECT id FROM octo.files WHERE workspace_id = $1 AND id = $2',
      [fixture.workspace.id, fixture.file.id]
    );
    expect(stillPresent).toHaveLength(1);

    await queryService("UPDATE octo.jobs SET state = 'completed' WHERE id = $1", [jobId]);
    const deleted = await request.delete(url, { headers });
    expect(deleted.status()).toBe(200);
  });
}

test('refuses file deletion while an on-demand restore is active', async ({ request }) => {
  const fixture = await createFileFixture(request);
  await queryService("UPDATE octo.files SET archive_state = 'restoring' WHERE id = $1", [fixture.file.id]);

  const headers = { Authorization: `Bearer ${fixture.sessionToken}` };
  const url = `/api/files/${fixture.file.id}?workspaceId=${fixture.workspace.id}`;
  const refused = await request.delete(url, { headers });
  expect(refused.status()).toBe(409);

  await queryService("UPDATE octo.files SET archive_state = 'active_r2' WHERE id = $1", [fixture.file.id]);
  expect((await request.delete(url, { headers })).status()).toBe(200);
});

for (const jobType of ['archive_file', 'restore_file'] as const) {
  test(`generic job enqueue cannot bypass the ${jobType} route`, async ({ request }) => {
    const fixture = await createFileFixture(request);
    const response = await request.post('/api/jobs', {
      headers: { Authorization: `Bearer ${fixture.sessionToken}` },
      data: {
        workspaceId: fixture.workspace.id,
        jobType,
        idempotencyKey: `bypass-${randomUUID()}`,
        payload: { fileId: fixture.file.id },
      },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toContain('JOB_TYPE_RESERVED');
  });
}

test('manual retry requeues an archive only while its file still exists', async ({ request }) => {
  const fixture = await createFileFixture(request);
  const queued = await dbEnqueueFileTransition(
    randomUUID(),
    fixture.workspace.id,
    'archive',
    `archive:${fixture.file.id}`,
    { fileId: fixture.file.id, storageKey: `test/${fixture.file.id}`, mimeType: 'text/plain' },
    fixture.principal.id
  );
  expect(queued.status).toBe('queued');
  if (queued.status !== 'queued') return;
  await queryService("UPDATE octo.jobs SET state = 'failed' WHERE id = $1", [queued.job.id]);

  const headers = { Authorization: `Bearer ${fixture.sessionToken}` };
  const retry = await request.post(
    `/api/jobs/${queued.job.id}/retry?workspaceId=${fixture.workspace.id}`,
    { headers }
  );
  expect(retry.status()).toBe(200);

  const refusedDelete = await request.delete(
    `/api/files/${fixture.file.id}?workspaceId=${fixture.workspace.id}`,
    { headers }
  );
  expect(refusedDelete.status()).toBe(409);
});

test('requeues a failed archive whose file was deleted so the worker can clear it', async ({ request }) => {
  const fixture = await createFileFixture(request);
  const queued = await dbEnqueueFileTransition(
    randomUUID(),
    fixture.workspace.id,
    'archive',
    `archive:${fixture.file.id}`,
    { fileId: fixture.file.id, storageKey: `test/${fixture.file.id}`, mimeType: 'text/plain' },
    fixture.principal.id
  );
  expect(queued.status).toBe('queued');
  if (queued.status !== 'queued') return;

  const headers = { Authorization: `Bearer ${fixture.sessionToken}` };
  // The job fails, then the file is deleted. The job is now moot, but leaving it
  // failed would strand an error the owner can neither retry nor dismiss.
  await queryService("UPDATE octo.jobs SET state = 'failed' WHERE id = $1", [queued.job.id]);
  const deleted = await request.delete(
    `/api/files/${fixture.file.id}?workspaceId=${fixture.workspace.id}`,
    { headers }
  );
  expect(deleted.status()).toBe(200);

  const retry = await request.post(
    `/api/jobs/${queued.job.id}/retry?workspaceId=${fixture.workspace.id}`,
    { headers }
  );
  expect(retry.status()).toBe(200);

  const requeued = await queryService<{ state: string }>('SELECT state FROM octo.jobs WHERE id = $1', [
    queued.job.id,
  ]);
  expect(requeued[0]!.state).toBe('queued');
});
