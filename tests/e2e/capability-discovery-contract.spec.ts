/**
 * Playwright API/E2E contract for workspace capability discovery.
 *
 * Fixtures use fresh guest principals and UUID-suffixed workspace names so the
 * assertions do not depend on a pre-seeded workspace or leak authority between
 * scenarios. The membership rows are seeded directly because the current UI
 * does not yet provide an invitation/member-management flow.
 */

import { expect, test, APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { query } from '../../src/server/db';

interface GuestSession {
  principal: { id: string; isGuest: boolean };
  workspace: { id: string; slug: string; role: string };
  sessionToken: string;
}

interface MintedKey {
  apiKey: { id: string; workspaceId: string | null; scopes: string[] };
  rawSecret: string;
}

interface CapabilityDescriptor {
  action: string;
  method: string;
  path: string;
  requiredScope: string;
}

interface CapabilityDiscovery {
  contractVersion: number;
  discoveryMode: 'workspace' | 'unbound';
  workspace: { id: string; role: string } | null;
  principal: { id: string; isGuest: boolean };
  token:
    | { type: 'session' }
    | { prefix: string; workspaceId: string | null; isAccountWide: boolean; scopes: string[] };
  auth: { scheme: string; header: string; note: string };
  capabilities: CapabilityDescriptor[];
  unavailable: Array<{ action: string; reason: 'PROVIDER_UNAVAILABLE' }>;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createGuest(request: APIRequestContext): Promise<GuestSession> {
  const response = await request.post('/api/auth/guest', {
    data: { displayName: `Capability E2E ${randomUUID()}` },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as GuestSession;
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
    data: { name: `${name} ${randomUUID()}`, workspaceId, scopes },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as MintedKey;
}

function actions(discovery: CapabilityDiscovery): Set<string> {
  return new Set(discovery.capabilities.map((capability) => capability.action));
}

test.describe('Workspace capability discovery contract', () => {
  test('workspace keys discover only their workspace and preserve the unbound wire shape', async ({
    request,
  }) => {
    const owner = await createGuest(request);
    const otherWorkspaceResponse = await request.post('/api/workspaces', {
      headers: bearer(owner.sessionToken),
      data: { name: `Capability Other ${randomUUID()}` },
    });
    expect(otherWorkspaceResponse.status()).toBe(201);
    const otherWorkspace = (await otherWorkspaceResponse.json()).workspace as { id: string };

    const fixtureName = `capability-read-${randomUUID()}.txt`;
    const fixtureBytes = `capability fixture ${randomUUID()}`;
    const uploadFixture = await request.post('/api/files/upload', {
      headers: bearer(owner.sessionToken),
      data: {
        workspaceId: owner.workspace.id,
        name: fixtureName,
        mimeType: 'text/plain',
        data: fixtureBytes,
        dataEncoding: 'utf8',
      },
    });
    expect(uploadFixture.status()).toBe(201);
    const fixture = (await uploadFixture.json()) as { id: string };

    const key = await createWorkspaceKey(
      request,
      owner.sessionToken,
      owner.workspace.id,
      ['read', 'files'],
      'capability reader'
    );
    const keyHeaders = bearer(key.rawSecret);

    const selectedResponse = await request.get(
      `/api/capabilities?workspaceId=${owner.workspace.id}`,
      { headers: keyHeaders }
    );
    expect(selectedResponse.status()).toBe(200);
    const selected = (await selectedResponse.json()) as CapabilityDiscovery;
    const selectedActions = actions(selected);

    expect(selected.contractVersion).toBe(1);
    expect(selected.discoveryMode).toBe('workspace');
    expect(selected.workspace).toEqual({ id: owner.workspace.id, role: 'owner' });
    expect(selected.principal).toEqual({ id: owner.principal.id, isGuest: true });
    expect(selected.token).toMatchObject({
      workspaceId: owner.workspace.id,
      isAccountWide: false,
      scopes: ['read', 'files'],
    });
    expect(selected.auth).toMatchObject({ scheme: 'Bearer', header: expect.stringContaining('Authorization: Bearer') });
    expect(selectedActions.has('files.list')).toBe(true);
    expect(selectedActions.has('files.download')).toBe(true);
    expect(selectedActions.has('gallery.list')).toBe(true);
    expect(selectedActions.has('files.upload')).toBe(false);
    expect(selectedActions.has('workspaces.create')).toBe(false);

    const listedFiles = await request.get(`/api/files?workspaceId=${owner.workspace.id}`, {
      headers: keyHeaders,
    });
    expect(listedFiles.status()).toBe(200);
    expect((await listedFiles.json()).some((file: { id: string }) => file.id === fixture.id)).toBe(true);

    const download = await request.get(
      `/api/files/download?workspaceId=${owner.workspace.id}&fileId=${fixture.id}`,
      { headers: keyHeaders }
    );
    expect(download.status()).toBe(200);
    expect((await download.json()).downloadUrl).toBeTruthy();

    const content = await request.get(
      `/api/files/content?workspaceId=${owner.workspace.id}&fileId=${fixture.id}`,
      { headers: keyHeaders }
    );
    expect(content.status()).toBe(200);
    expect(await content.text()).toBe(fixtureBytes);

    const refusedUpload = await request.post('/api/files/upload', {
      headers: keyHeaders,
      data: {
        workspaceId: owner.workspace.id,
        name: 'read-only-refused.txt',
        data: 'not allowed',
        dataEncoding: 'utf8',
      },
    });
    expect(refusedUpload.status()).toBe(403);

    const crossWorkspace = await request.get(
      `/api/capabilities?workspaceId=${otherWorkspace.id}`,
      { headers: keyHeaders }
    );
    expect(crossWorkspace.status()).toBe(403);
    expect(await crossWorkspace.json()).toMatchObject({
      error: 'WORKSPACE_ACCESS_DENIED',
      code: 'WORKSPACE_ACCESS_DENIED',
      message: expect.any(String),
    });

    const crossWorkspaceFiles = await request.get(`/api/files?workspaceId=${otherWorkspace.id}`, {
      headers: keyHeaders,
    });
    expect(crossWorkspaceFiles.status()).toBe(403);
    for (const path of [
      `/api/files/download?workspaceId=${otherWorkspace.id}&fileId=${fixture.id}`,
      `/api/files/content?workspaceId=${otherWorkspace.id}&fileId=${fixture.id}`,
      `/api/files/thumbnail?workspaceId=${otherWorkspace.id}&fileId=${fixture.id}`,
      `/api/gallery?workspaceId=${otherWorkspace.id}`,
    ]) {
      expect((await request.get(path, { headers: keyHeaders })).status()).toBe(403);
    }

    // Omitting workspaceId remains compatible with the existing discovery
    // fields while clearly identifying the response as unbound.
    const unboundResponse = await request.get('/api/capabilities', { headers: keyHeaders });
    expect(unboundResponse.status()).toBe(200);
    const unbound = (await unboundResponse.json()) as CapabilityDiscovery;
    expect(unbound).toMatchObject({
      contractVersion: 1,
      discoveryMode: 'unbound',
      workspace: null,
      principal: { id: owner.principal.id, isGuest: true },
      token: { workspaceId: owner.workspace.id, isAccountWide: false, scopes: ['read', 'files'] },
      auth: { scheme: 'Bearer' },
      unavailable: [],
    });
    expect(actions(unbound).has('workspaces.create')).toBe(false);

    const accountKeyResponse = await request.post('/api/keys', {
      headers: bearer(owner.sessionToken),
      data: { name: `capability account writer ${randomUUID()}`, scopes: ['write'] },
    });
    expect(accountKeyResponse.status()).toBe(201);
    const accountKey = (await accountKeyResponse.json()) as MintedKey;
    const accountDiscovery = await request.get(
      `/api/capabilities?workspaceId=${owner.workspace.id}`,
      { headers: bearer(accountKey.rawSecret) }
    );
    expect(accountDiscovery.status()).toBe(200);
    expect(actions((await accountDiscovery.json()) as CapabilityDiscovery).has('workspaces.create')).toBe(true);
    expect((await request.delete(`/api/keys/${accountKey.apiKey.id}`, {
      headers: bearer(owner.sessionToken),
    })).status()).toBe(200);

    const unauthenticated = await request.get(
      `/api/capabilities?workspaceId=${owner.workspace.id}`
    );
    expect(unauthenticated.status()).toBe(401);
    expect(await unauthenticated.json()).toMatchObject({
      error: 'UNAUTHENTICATED',
      code: 'UNAUTHENTICATED',
      message: expect.any(String),
    });

    const malformedId = await request.get('/api/capabilities?workspaceId=not-a-uuid', {
      headers: keyHeaders,
    });
    expect(malformedId.status()).toBe(400);
    expect(await malformedId.json()).toMatchObject({
      error: 'INVALID_WORKSPACE_ID',
      code: 'INVALID_WORKSPACE_ID',
      message: expect.any(String),
    });

    expect((await request.delete(`/api/keys/${key.apiKey.id}`, {
      headers: bearer(owner.sessionToken),
    })).status()).toBe(200);
    expect((await request.get(`/api/capabilities?workspaceId=${owner.workspace.id}`, {
      headers: keyHeaders,
    })).status()).toBe(401);
    expect((await request.get(`/api/files?workspaceId=${owner.workspace.id}`, {
      headers: keyHeaders,
    })).status()).toBe(401);
  });

  test('a member key with write scope cannot discover or invoke operator-only actions, and live membership removal takes effect', async ({
    request,
  }) => {
    const owner = await createGuest(request);
    const member = await createGuest(request);
    await query(
      `INSERT INTO octo.workspace_memberships (workspace_id, principal_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (workspace_id, principal_id) DO UPDATE SET role = 'member', updated_at = now()`,
      [owner.workspace.id, member.principal.id]
    );

    const key = await createWorkspaceKey(
      request,
      member.sessionToken,
      owner.workspace.id,
      ['read', 'write', 'files'],
      'capability member writer'
    );
    const keyHeaders = bearer(key.rawSecret);
    const discoveryResponse = await request.get(
      `/api/capabilities?workspaceId=${owner.workspace.id}`,
      { headers: keyHeaders }
    );
    expect(discoveryResponse.status()).toBe(200);
    const discovery = (await discoveryResponse.json()) as CapabilityDiscovery;
    const memberActions = actions(discovery);

    expect(discovery.workspace).toEqual({ id: owner.workspace.id, role: 'member' });
    expect(memberActions.has('files.upload')).toBe(false);
    expect(memberActions.has('jobs.run')).toBe(false);

    // A workspace key retains its role cap if live membership is promoted.
    await query(
      `UPDATE octo.workspace_memberships SET role = 'operator', updated_at = now()
       WHERE workspace_id = $1 AND principal_id = $2`,
      [owner.workspace.id, member.principal.id]
    );
    const afterPromotionResponse = await request.get(
      `/api/capabilities?workspaceId=${owner.workspace.id}`,
      { headers: keyHeaders }
    );
    expect(afterPromotionResponse.status()).toBe(200);
    const afterPromotion = (await afterPromotionResponse.json()) as CapabilityDiscovery;
    expect(afterPromotion.workspace).toEqual({ id: owner.workspace.id, role: 'member' });
    expect(actions(afterPromotion).has('files.upload')).toBe(false);

    const upload = await request.post('/api/files/upload', {
      headers: keyHeaders,
      data: {
        workspaceId: owner.workspace.id,
        name: `member-denied-${randomUUID()}.txt`,
        mimeType: 'text/plain',
        data: 'must not upload',
        dataEncoding: 'utf8',
      },
    });
    expect(upload.status()).toBe(403);

    const runWorker = await request.post(
      `/api/jobs/run?workspaceId=${owner.workspace.id}`,
      { headers: keyHeaders }
    );
    expect(runWorker.status()).toBe(403);

    await query(
      'DELETE FROM octo.workspace_memberships WHERE workspace_id = $1 AND principal_id = $2',
      [owner.workspace.id, member.principal.id]
    );

    const afterRemoval = await request.get(
      `/api/capabilities?workspaceId=${owner.workspace.id}`,
      { headers: keyHeaders }
    );
    expect(afterRemoval.status()).toBe(403);
    expect(await afterRemoval.json()).toMatchObject({
      error: 'WORKSPACE_ACCESS_DENIED',
      code: 'WORKSPACE_ACCESS_DENIED',
      message: expect.any(String),
    });

    const afterRemovalFileList = await request.get(
      `/api/files?workspaceId=${owner.workspace.id}`,
      { headers: keyHeaders }
    );
    expect(afterRemovalFileList.status()).toBe(403);
  });

  test('unconfigured Drive marks authorized archive actions unavailable and operations return 503', async ({
    request,
  }) => {
    const owner = await createGuest(request);
    const key = await createWorkspaceKey(
      request,
      owner.sessionToken,
      owner.workspace.id,
      ['read', 'write', 'delete', 'files'],
      'capability archive operator'
    );
    const keyHeaders = bearer(key.rawSecret);

    const upload = await request.post('/api/files/upload', {
      headers: keyHeaders,
      data: {
        workspaceId: owner.workspace.id,
        name: `archive-provider-${randomUUID()}.txt`,
        mimeType: 'text/plain',
        data: 'archive fixture',
        dataEncoding: 'utf8',
      },
    });
    expect(upload.status()).toBe(201);
    const file = (await upload.json()) as { id: string };

    const discoveryResponse = await request.get(
      `/api/capabilities?workspaceId=${owner.workspace.id}`,
      { headers: keyHeaders }
    );
    expect(discoveryResponse.status()).toBe(200);
    const discovery = (await discoveryResponse.json()) as CapabilityDiscovery;
    const unavailable = new Set(discovery.unavailable.map((entry) => entry.action));

    // CI intentionally has no Google Drive credentials. Keep local runs with a
    // configured Drive provider useful without treating a configured provider
    // as an unavailable one.
    test.skip(
      !unavailable.has('files.archive') || !unavailable.has('files.restore'),
      'Google Drive is configured in this test environment'
    );

    expect(actions(discovery).has('files.archive')).toBe(false);
    expect(actions(discovery).has('files.restore')).toBe(false);
    expect(discovery.unavailable).toEqual(
      expect.arrayContaining([
        { action: 'files.archive', reason: 'PROVIDER_UNAVAILABLE' },
        { action: 'files.restore', reason: 'PROVIDER_UNAVAILABLE' },
      ])
    );

    for (const direction of ['archive', 'restore'] as const) {
      const operation = await request.post(
        `/api/files/${file.id}/${direction}?workspaceId=${owner.workspace.id}`,
        { headers: keyHeaders }
      );
      expect(operation.status()).toBe(503);
      expect((await operation.json()).error).toContain('ARCHIVE_UNAVAILABLE');
    }
  });
});
