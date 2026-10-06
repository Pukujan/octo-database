/**
 * Playwright E2E: typed multi-tenant keys (Slice 19, #127)
 *
 * A key class is a documented authority profile a consumer is provisioned under
 * ("analytics", "agent-read", "program-write"). The class expands to the real
 * scopes at mint time and is enforced by the same `requireScope` every route
 * already uses, so it is a preset over scopes and never a second authorization
 * dimension. These cases drive the real mint route and then each profile's own
 * routes with the minted key, proving the profile end to end rather than only
 * that the catalog lists it.
 *
 * The metamorphic property closes the loop: a key minted by class and a key
 * minted with the class's explicit scope list, same principal and workspace,
 * must be indistinguishable -- identical capability discovery and identical
 * route decisions. That is what makes the catalog a preset and not a parallel
 * authorization model.
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
    data: { displayName: `Typed Keys E2E ${randomUUID()}` },
  });
  expect(response.status()).toBe(201);
  const session = (await response.json()) as GuestSession;
  await setConfirmSecret(request, session.sessionToken);
  return session;
}

async function mint(
  request: APIRequestContext,
  sessionToken: string,
  body: Record<string, unknown>
): Promise<{ status: number; body: Partial<MintedKey> & { error?: string } }> {
  const response = await request.post('/api/keys', {
    headers: bearer(sessionToken),
    data: body,
  });
  const payload = (await response.json().catch(() => ({}))) as Partial<MintedKey> & {
    error?: string;
  };
  return { status: response.status(), body: payload };
}

async function mintClass(
  request: APIRequestContext,
  sessionToken: string,
  workspaceId: string,
  keyClass: string
): Promise<MintedKey> {
  const result = await mint(request, sessionToken, {
    name: `${keyClass} ${randomUUID()}`,
    workspaceId,
    keyClass,
    confirmSecret: CONFIRM_SECRET,
  });
  expect(result.status).toBe(201);
  return result.body as MintedKey;
}

test.describe('Typed multi-tenant keys', () => {
  test('analytics reads metadata but no file bytes and no mutations', async ({ request }) => {
    const owner = await createGuest(request);
    const key = await mintClass(request, owner.sessionToken, owner.workspace.id, 'analytics');
    expect(key.apiKey.scopes).toEqual(['read']);
    const headers = bearer(key.rawSecret);

    // Inside the profile: metadata reads.
    expect(
      (await request.get(`/api/activity?workspaceId=${owner.workspace.id}`, { headers })).status()
    ).toBe(200);
    expect(
      (await request.get(`/api/jobs?workspaceId=${owner.workspace.id}`, { headers })).status()
    ).toBe(200);

    // Outside the profile: no file bytes (needs `files`), no upload (needs `write`).
    expect(
      (await request.get(`/api/files?workspaceId=${owner.workspace.id}`, { headers })).status()
    ).toBe(403);
    expect(
      (
        await request.post('/api/files/upload', {
          headers,
          data: {
            workspaceId: owner.workspace.id,
            name: 'analytics-denied.txt',
            data: 'no',
            dataEncoding: 'utf8',
          },
        })
      ).status()
    ).toBe(403);
  });

  test('agent-read reads file bytes but cannot write', async ({ request }) => {
    const owner = await createGuest(request);
    const upload = await request.post('/api/files/upload', {
      headers: bearer(owner.sessionToken),
      data: {
        workspaceId: owner.workspace.id,
        name: `agent-read-${randomUUID()}.txt`,
        mimeType: 'text/plain',
        data: 'agent read fixture',
        dataEncoding: 'utf8',
      },
    });
    expect(upload.status()).toBe(201);
    const file = (await upload.json()) as { id: string };

    const key = await mintClass(request, owner.sessionToken, owner.workspace.id, 'agent-read');
    expect(key.apiKey.scopes).toEqual(['read', 'files']);
    const headers = bearer(key.rawSecret);

    // Inside the profile: file listing and bytes.
    expect(
      (await request.get(`/api/files?workspaceId=${owner.workspace.id}`, { headers })).status()
    ).toBe(200);
    const content = await request.get(
      `/api/files/content?workspaceId=${owner.workspace.id}&fileId=${file.id}`,
      { headers }
    );
    expect(content.status()).toBe(200);
    expect(await content.text()).toBe('agent read fixture');

    // Outside the profile: no upload.
    expect(
      (
        await request.post('/api/files/upload', {
          headers,
          data: {
            workspaceId: owner.workspace.id,
            name: 'agent-read-denied.txt',
            data: 'no',
            dataEncoding: 'utf8',
          },
        })
      ).status()
    ).toBe(403);
  });

  test('program-write writes but cannot delete or revoke', async ({ request }) => {
    const owner = await createGuest(request);
    const key = await mintClass(request, owner.sessionToken, owner.workspace.id, 'program-write');
    expect(key.apiKey.scopes).toEqual(['read', 'write', 'files']);
    const headers = bearer(key.rawSecret);

    // Inside the profile: upload.
    expect(
      (
        await request.post('/api/files/upload', {
          headers,
          data: {
            workspaceId: owner.workspace.id,
            name: `program-write-${randomUUID()}.txt`,
            mimeType: 'text/plain',
            data: 'program write fixture',
            dataEncoding: 'utf8',
          },
        })
      ).status()
    ).toBe(201);

    // Outside the profile: file delete and share revocation both need `delete`.
    expect(
      (
        await request.delete(
          `/api/files/${randomUUID()}?workspaceId=${owner.workspace.id}`,
          { headers }
        )
      ).status()
    ).toBe(403);
    expect(
      (
        await request.delete(
          `/api/shares/${randomUUID()}?workspaceId=${owner.workspace.id}`,
          { headers }
        )
      ).status()
    ).toBe(403);
  });

  test('malformed class requests are clean 400s and admin is no longer a scope', async ({
    request,
  }) => {
    const owner = await createGuest(request);

    const both = await mint(request, owner.sessionToken, {
      name: 'both',
      workspaceId: owner.workspace.id,
      keyClass: 'analytics',
      scopes: ['read'],
      confirmSecret: CONFIRM_SECRET,
    });
    expect(both.status).toBe(400);
    expect(both.body.error).toMatch(/mutually exclusive/);

    const unknown = await mint(request, owner.sessionToken, {
      name: 'unknown class',
      workspaceId: owner.workspace.id,
      keyClass: 'not-a-class',
      confirmSecret: CONFIRM_SECRET,
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toMatch(/keyClass must be one of/);

    // `admin` was accepted at mint but enforced nowhere; it is removed, so it is
    // now rejected like any other unknown scope.
    const admin = await mint(request, owner.sessionToken, {
      name: 'admin scope',
      workspaceId: owner.workspace.id,
      scopes: ['admin'],
      confirmSecret: CONFIRM_SECRET,
    });
    expect(admin.status).toBe(400);
    expect(admin.body.error).toMatch(/unknown scopes/);
  });

  test('a revoked class key is refused like any other credential', async ({ request }) => {
    const owner = await createGuest(request);
    const key = await mintClass(request, owner.sessionToken, owner.workspace.id, 'analytics');

    const revoked = await request.delete(`/api/keys/${key.apiKey.id}`, {
      headers: bearer(owner.sessionToken),
    });
    expect(revoked.status()).toBe(200);

    expect(
      (
        await request.get(`/api/activity?workspaceId=${owner.workspace.id}`, {
          headers: bearer(key.rawSecret),
        })
      ).status()
    ).toBe(401);
  });

  test('a class key and its explicit scope list are indistinguishable (metamorphic)', async ({
    request,
  }) => {
    const owner = await createGuest(request);

    const byClass = await mintClass(request, owner.sessionToken, owner.workspace.id, 'agent-read');
    const byScopes = await mint(request, owner.sessionToken, {
      name: `explicit ${randomUUID()}`,
      workspaceId: owner.workspace.id,
      scopes: ['read', 'files'],
      confirmSecret: CONFIRM_SECRET,
    });
    expect(byScopes.status).toBe(201);
    const explicit = byScopes.body as MintedKey;

    expect(byClass.apiKey.scopes).toEqual(explicit.apiKey.scopes);

    // Identical capability discovery: same actions, same required scopes.
    const classDiscovery = await (
      await request.get(`/api/capabilities?workspaceId=${owner.workspace.id}`, {
        headers: bearer(byClass.rawSecret),
      })
    ).json();
    const explicitDiscovery = await (
      await request.get(`/api/capabilities?workspaceId=${owner.workspace.id}`, {
        headers: bearer(explicit.rawSecret),
      })
    ).json();
    expect(classDiscovery.capabilities).toEqual(explicitDiscovery.capabilities);
    // The prefix is per-key and legitimately differs; the authority does not.
    expect(classDiscovery.token).toMatchObject({
      workspaceId: explicitDiscovery.token.workspaceId,
      isAccountWide: explicitDiscovery.token.isAccountWide,
      scopes: explicitDiscovery.token.scopes,
    });

    // Identical route decisions.
    for (const key of [byClass, explicit]) {
      const headers = bearer(key.rawSecret);
      expect(
        (await request.get(`/api/files?workspaceId=${owner.workspace.id}`, { headers })).status()
      ).toBe(200);
      expect(
        (
          await request.post('/api/files/upload', {
            headers,
            data: {
              workspaceId: owner.workspace.id,
              name: 'metamorphic-denied.txt',
              data: 'no',
              dataEncoding: 'utf8',
            },
          })
        ).status()
      ).toBe(403);
    }
  });
});
