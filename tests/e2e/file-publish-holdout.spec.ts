/**
 * Hidden holdout for public publish (issue #175).
 *
 * HTTP only. The file name contains a slash and is not a db-public- prefix.
 * The public URL is the file id and nothing from the private storage key.
 */

import { expect, test, APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { CONFIRM_SECRET, setConfirmSecret } from './confirm-secret';

interface GuestSession {
  principal: { id: string };
  workspace: { id: string };
  sessionToken: string;
}

const PUBLIC_ROOT = 'http://127.0.0.1:3001/public/files';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createGuest(request: APIRequestContext): Promise<GuestSession> {
  const response = await request.post('/api/auth/guest', {
    data: { displayName: `Holdout ${randomUUID()}` },
  });
  expect(response.status()).toBe(201);
  const session = (await response.json()) as GuestSession;
  await setConfirmSecret(request, session.sessionToken);
  return session;
}

test('a slashed holdout name publishes as one unguessable url', async ({ request }) => {
  const workspaceA = await createGuest(request);
  const workspaceB = await createGuest(request);
  const marker = randomUUID();
  const payload = `{"holdout":"${marker}"}`;
  const name = 'notes/q3-brief.dat';

  const upload = await request.post('/api/files/upload', {
    headers: bearer(workspaceA.sessionToken),
    data: {
      workspaceId: workspaceA.workspace.id,
      name,
      mimeType: 'application/vnd.octo.holdout+json',
      data: payload,
      dataEncoding: 'utf8',
    },
  });
  expect(upload.status()).toBe(201);
  const file = (await upload.json()) as { id: string; storageKey?: string };
  expect(name.includes('db-public-')).toBe(false);

  const published = await request.post(
    `/api/files/${file.id}/publish?workspaceId=${workspaceA.workspace.id}`,
    { headers: bearer(workspaceA.sessionToken) }
  );
  expect(published.status()).toBe(200);
  const body = (await published.json()) as { url: string };
  expect(body.url).toBe(`${PUBLIC_ROOT}/${file.id}`);
  expect(body.url).not.toContain(workspaceA.workspace.id);
  expect(body.url).not.toContain('workspaces/');
  expect(body.url).not.toContain(name);
  if (file.storageKey) expect(body.url).not.toContain(file.storageKey);
  expect(new URL(body.url).pathname.split('/').filter(Boolean).at(-1)).toBe(file.id);

  const anon = await request.get(body.url);
  expect(anon.status()).toBe(200);
  expect(anon.headers()['content-type']).toBe('application/vnd.octo.holdout+json');
  const anonBody = await anon.text();
  expect(anonBody).toBe(payload);
  expect(anonBody).not.toContain(workspaceA.workspace.id);
  const headerBlob = JSON.stringify(anon.headers());
  expect(headerBlob).not.toContain(workspaceA.workspace.id);
  expect(headerBlob).not.toContain('storageKey');

  const otherWorkspace = await request.post(
    `/api/files/${file.id}/publish?workspaceId=${workspaceB.workspace.id}`,
    { headers: bearer(workspaceB.sessionToken) }
  );
  expect(otherWorkspace.status()).toBe(404);
  expect((await otherWorkspace.json()).error).toBe('FILE_NOT_FOUND');

  const keyResponse = await request.post('/api/keys', {
    headers: bearer(workspaceB.sessionToken),
    data: {
      name: `holdout-b ${randomUUID()}`,
      workspaceId: workspaceB.workspace.id,
      scopes: ['read', 'write', 'files'],
      confirmSecret: CONFIRM_SECRET,
    },
  });
  expect(keyResponse.status()).toBe(201);
  const key = (await keyResponse.json()) as { rawSecret: string };

  const crossKey = await request.post(
    `/api/files/${file.id}/publish?workspaceId=${workspaceA.workspace.id}`,
    { headers: bearer(key.rawSecret) }
  );
  expect(crossKey.status()).toBe(403);
  expect((await crossKey.json()).error as string).toContain('Key restricted');

  expect((await request.get(PUBLIC_ROOT)).status()).toBe(404);
  expect((await request.get(`${PUBLIC_ROOT}/`)).status()).toBe(404);
});
