/**
 * Playwright E2E HOLDOUT: typed multi-tenant keys (Slice 19, #127)
 *
 * This is the slice's declared hidden holdout. The public spec drives the
 * profile refusals over HTTP on the routes it happens to name. This one changes
 * the surface, the route, and the pairing:
 *
 *   * surface  — the **real MCP `download_file` tool** (adapter + client), not a
 *     direct HTTP call, so an implementation that only gated the HTTP routes the
 *     public spec calls would still be exercised through a second surface;
 *   * route    — `/api/files/content` (the byte stream), not `/api/files`;
 *   * pairing  — an `analytics` key is refused while an `agent-read` key
 *     retrieves the identical bytes, so the refusal is the missing `files`
 *     scope and not a dead key.
 *
 * The two keys are minted over HTTP against one workspace holding one uploaded
 * file, then each is handed to its own MCP server over an in-memory transport.
 */

import { expect, test, APIRequestContext } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { randomUUID } from 'node:crypto';
import { OctoApi } from '../../src/mcp/client';
import { createOctoMcpServer } from '../../src/mcp/server';
import { CONFIRM_SECRET, setConfirmSecret } from './confirm-secret';

interface GuestSession {
  principal: { id: string };
  workspace: { id: string; slug: string };
  sessionToken: string;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

// The E2E webServer runs the API on 3001; the MCP adapter talks to it directly,
// exactly as `scripts/octo-mcp.ts` does.
const API_BASE = 'http://localhost:3001';

async function createGuest(request: APIRequestContext): Promise<GuestSession> {
  const response = await request.post('/api/auth/guest', {
    data: { displayName: `Typed Keys Holdout ${randomUUID()}` },
  });
  expect(response.status()).toBe(201);
  const session = (await response.json()) as GuestSession;
  await setConfirmSecret(request, session.sessionToken);
  return session;
}

async function mintClass(
  request: APIRequestContext,
  sessionToken: string,
  workspaceId: string,
  keyClass: string
): Promise<string> {
  const response = await request.post('/api/keys', {
    headers: bearer(sessionToken),
    data: {
      name: `${keyClass} ${randomUUID()}`,
      workspaceId,
      keyClass,
      confirmSecret: CONFIRM_SECRET,
    },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { rawSecret: string }).rawSecret;
}

/** A live MCP client whose adapter holds the given bearer token. */
async function mcpClient(token: string): Promise<Client> {
  const server = createOctoMcpServer(new OctoApi({ baseUrl: API_BASE, token }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'typed-keys-holdout', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function textOf(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return content.map((part) => part.text).join('');
}

test.describe('Typed keys — holdout', () => {
  test('an analytics key is refused a file byte read through MCP while agent-read retrieves it', async ({
    request,
  }) => {
    const owner = await createGuest(request);

    const bytes = `holdout bytes ${randomUUID()}`;
    const upload = await request.post('/api/files/upload', {
      headers: bearer(owner.sessionToken),
      data: {
        workspaceId: owner.workspace.id,
        name: `holdout-${randomUUID()}.txt`,
        mimeType: 'text/plain',
        data: bytes,
        dataEncoding: 'utf8',
      },
    });
    expect(upload.status()).toBe(201);
    const file = (await upload.json()) as { id: string };

    const analytics = await mcpClient(
      await mintClass(request, owner.sessionToken, owner.workspace.id, 'analytics')
    );
    const agentRead = await mcpClient(
      await mintClass(request, owner.sessionToken, owner.workspace.id, 'agent-read')
    );

    // analytics lacks the `files` scope, so the content route refuses it and the
    // adapter surfaces the API's decision as a tool error, not a success.
    const refused = await analytics.callTool({
      name: 'download_file',
      arguments: { workspaceId: owner.workspace.id, fileId: file.id },
    });
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain('403');

    // agent-read holds `files`, so the same call returns the identical bytes --
    // proving the refusal above is the missing scope, not a broken key or route.
    const allowed = await agentRead.callTool({
      name: 'download_file',
      arguments: { workspaceId: owner.workspace.id, fileId: file.id },
    });
    expect(allowed.isError).toBeFalsy();
    expect(JSON.parse(textOf(allowed))).toBe(Buffer.from(bytes).toString('base64'));
  });
});
