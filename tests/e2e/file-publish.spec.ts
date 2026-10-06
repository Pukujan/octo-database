/**
 * Public file publish (issue #175).
 *
 * One active file is copied to a stable URL. The private download link stays
 * separate, and a file that was not published is not readable there.
 */

import { expect, test, APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { queryService } from '../../src/server/db';
import { CONFIRM_SECRET, setConfirmSecret } from './confirm-secret';

interface GuestSession {
  principal: { id: string };
  workspace: { id: string };
  sessionToken: string;
}

interface MintedKey {
  apiKey: { id: string; scopes: string[] };
  rawSecret: string;
}

const PUBLIC_BASE = 'http://127.0.0.1:3001/public/files';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createGuest(request: APIRequestContext, label: string): Promise<GuestSession> {
  const response = await request.post('/api/auth/guest', {
    data: { displayName: `${label} ${randomUUID()}` },
  });
  expect(response.status()).toBe(201);
  const session = (await response.json()) as GuestSession;
  await setConfirmSecret(request, session.sessionToken);
  return session;
}

async function createWorkspaceKey(
  request: APIRequestContext,
  sessionToken: string,
  workspaceId: string,
  scopes: string[],
  name: string
): Promise<MintedKey> {
  const response = await request.post('/api/keys', {
    headers: bearer(sessionToken),
    data: { name: `${name} ${randomUUID()}`, workspaceId, scopes, confirmSecret: CONFIRM_SECRET },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as MintedKey;
}

async function uploadPng(request: APIRequestContext, token: string, workspaceId: string, name: string) {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
  const response = await request.post('/api/files/upload', {
    headers: bearer(token),
    data: {
      workspaceId,
      name,
      mimeType: 'image/png',
      data: bytes.toString('base64'),
      dataEncoding: 'base64',
    },
  });
  expect(response.status()).toBe(201);
  const file = (await response.json()) as { id: string };
  return { id: file.id, bytes };
}

test('publishes one png at a stable url and leaves the sibling private', async ({ request }) => {
  const owner = await createGuest(request, 'Publish owner');
  const workspaceId = owner.workspace.id;
  const cover = await uploadPng(request, owner.sessionToken, workspaceId, 'cover.png');
  const sibling = await uploadPng(request, owner.sessionToken, workspaceId, 'sibling.png');

  const published = await request.post(
    `/api/files/${cover.id}/publish?workspaceId=${workspaceId}`,
    { headers: bearer(owner.sessionToken) }
  );
  expect(published.status()).toBe(200);
  const body = (await published.json()) as {
    fileId: string;
    url: string;
    publishedAt: string;
    republished: boolean;
    storageKey?: string;
    publicKey?: string;
  };
  expect(body).toMatchObject({ fileId: cover.id, url: `${PUBLIC_BASE}/${cover.id}`, republished: false });
  expect(body.publishedAt).toBeTruthy();
  expect(body.storageKey).toBeUndefined();
  expect(body.publicKey).toBeUndefined();
  expect(body.url).not.toContain(workspaceId);

  const anon = await request.get(body.url);
  expect(anon.status()).toBe(200);
  expect(anon.headers()['content-type']).toBe('image/png');
  expect(Buffer.from(await anon.body()).equals(cover.bytes)).toBe(true);

  const siblingAnon = await request.get(`${PUBLIC_BASE}/${sibling.id}`);
  expect(siblingAnon.status()).toBe(404);

  const privateContent = await request.get(
    `/api/files/content?workspaceId=${workspaceId}&fileId=${cover.id}`
  );
  expect(privateContent.status()).toBe(401);

  const download = await request.get(
    `/api/files/download?workspaceId=${workspaceId}&fileId=${cover.id}`,
    { headers: bearer(owner.sessionToken) }
  );
  expect(download.status()).toBe(200);
  const downloaded = (await download.json()) as { downloadUrl: string; file: { publishedUrl: string } };
  expect(downloaded.downloadUrl).not.toBe(body.url);
  expect(downloaded.file.publishedUrl).toBe(body.url);

  const again = await request.post(`/api/files/${cover.id}/publish?workspaceId=${workspaceId}`, {
    headers: bearer(owner.sessionToken),
  });
  expect(again.status()).toBe(200);
  const republish = (await again.json()) as { url: string; republished: boolean };
  expect(republish.url).toBe(body.url);
  expect(republish.republished).toBe(true);

  const listed = await request.get(`/api/files?workspaceId=${workspaceId}`, {
    headers: bearer(owner.sessionToken),
  });
  expect(listed.status()).toBe(200);
  const files = (await listed.json()) as { id: string; publishedUrl: string | null }[];
  expect(files.find((file) => file.id === cover.id)?.publishedUrl).toBe(body.url);
  expect(files.find((file) => file.id === sibling.id)?.publishedUrl).toBeNull();

  const unpublished = await request.post(
    `/api/files/${cover.id}/unpublish?workspaceId=${workspaceId}`,
    { headers: bearer(owner.sessionToken) }
  );
  expect(unpublished.status()).toBe(200);
  expect(await unpublished.json()).toMatchObject({ fileId: cover.id, published: false });
  expect((await request.get(body.url)).status()).toBe(404);

  const stillPrivate = await request.get(
    `/api/files/content?workspaceId=${workspaceId}&fileId=${cover.id}`,
    { headers: bearer(owner.sessionToken) }
  );
  expect(stillPrivate.status()).toBe(200);
  expect(Buffer.from(await stillPrivate.body()).equals(cover.bytes)).toBe(true);
});

test('an operator key can publish and a member or read key cannot', async ({ request }) => {
  const owner = await createGuest(request, 'Publish role owner');
  const operator = await createGuest(request, 'Publish operator');
  const member = await createGuest(request, 'Publish member');
  await queryService(
    `INSERT INTO octo.workspace_memberships (workspace_id, principal_id, role)
     VALUES ($1, $2, 'operator'), ($1, $3, 'member')
     ON CONFLICT (workspace_id, principal_id) DO UPDATE SET role = EXCLUDED.role, updated_at = now()`,
    [owner.workspace.id, operator.principal.id, member.principal.id]
  );

  const cover = await uploadPng(request, owner.sessionToken, owner.workspace.id, 'cover.png');
  const operatorKey = await createWorkspaceKey(
    request,
    operator.sessionToken,
    owner.workspace.id,
    ['read', 'write', 'files'],
    'publish operator'
  );
  const published = await request.post(
    `/api/files/${cover.id}/publish?workspaceId=${owner.workspace.id}`,
    { headers: bearer(operatorKey.rawSecret) }
  );
  expect(published.status()).toBe(200);

  const memberKey = await createWorkspaceKey(
    request,
    member.sessionToken,
    owner.workspace.id,
    ['read', 'write', 'files'],
    'publish member'
  );
  const memberDiscovery = await request.get(
    `/api/capabilities?workspaceId=${owner.workspace.id}`,
    { headers: bearer(memberKey.rawSecret) }
  );
  expect(memberDiscovery.status()).toBe(200);
  const memberActions = new Set(
    ((await memberDiscovery.json()) as { capabilities: { action: string }[] }).capabilities.map(
      (capability) => capability.action
    )
  );
  expect(memberActions.has('files.publish')).toBe(false);
  const memberPublish = await request.post(
    `/api/files/${cover.id}/publish?workspaceId=${owner.workspace.id}`,
    { headers: bearer(memberKey.rawSecret) }
  );
  expect(memberPublish.status()).toBe(403);

  const reader = await createWorkspaceKey(
    request,
    owner.sessionToken,
    owner.workspace.id,
    ['read', 'files'],
    'publish reader'
  );
  const denied = await request.post(
    `/api/files/${cover.id}/publish?workspaceId=${owner.workspace.id}`,
    { headers: bearer(reader.rawSecret) }
  );
  expect(denied.status()).toBe(403);
  expect((await denied.json()).error as string).toContain('write');
});

test('an archived file is not published and its private bytes stay readable', async ({ request }) => {
  const owner = await createGuest(request, 'Publish archive');
  const cover = await uploadPng(request, owner.sessionToken, owner.workspace.id, 'cover.png');
  await queryService(`UPDATE octo.files SET archive_state = 'archived_drive' WHERE id = $1`, [cover.id]);

  const published = await request.post(
    `/api/files/${cover.id}/publish?workspaceId=${owner.workspace.id}`,
    { headers: bearer(owner.sessionToken) }
  );
  expect(published.status()).toBe(409);
  expect((await published.json()).error as string).toContain('FILE_NOT_ACTIVE');
  expect((await request.get(`${PUBLIC_BASE}/${cover.id}`)).status()).toBe(404);

  const content = await request.get(
    `/api/files/content?workspaceId=${owner.workspace.id}&fileId=${cover.id}`,
    { headers: bearer(owner.sessionToken) }
  );
  expect(content.status()).toBe(200);
  expect(Buffer.from(await content.body()).equals(cover.bytes)).toBe(true);
});
