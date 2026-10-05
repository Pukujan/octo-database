/**
 * Unit tests: the Octo MCP adapter, driven over a real MCP connection.
 *
 * These exercise the adapter the way an agent would: connect an MCP client to
 * the server over an in-memory transport, list the tools, and call them. The
 * point is that the adapter forwards to the API and reports the API's decision —
 * including a refusal, which must surface as a tool error rather than a success.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it } from 'vitest';
import { OctoApi } from '../../src/mcp/client';
import { createOctoMcpServer } from '../../src/mcp/server';

function apiWith(status: number, body: string, calls: string[] = []): OctoApi {
  const fetchImpl = (async (url: unknown) => {
    calls.push(String(url));
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return new OctoApi({ baseUrl: 'http://octo.test', token: 'octo_live_acc_test', fetchImpl });
}

async function connect(api: OctoApi): Promise<Client> {
  const server = createOctoMcpServer(api);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'octo-test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function textOf(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text: string }> }).content;
  return content.map((part) => part.text).join('');
}

describe('Octo MCP adapter', () => {
  it('advertises the workspace tools an agent manages Octo with', async () => {
    const client = await connect(apiWith(200, '{}'));

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'create_workspace',
      'delete_file',
      'download_file',
      'list_files',
      'list_workspaces',
      'mint_key',
      'query_workspace',
      'upload_file',
      'whoami',
    ]);
  });

  it('returns the API payload for a tool call', async () => {
    const client = await connect(apiWith(200, '[{"id":"w1","name":"Backups"}]'));

    const result = await client.callTool({ name: 'list_workspaces', arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('Backups');
  });

  it('reports an API refusal as a tool error, not a success', async () => {
    const client = await connect(apiWith(403, '{"error":"FORBIDDEN: key is bound to another workspace"}'));

    const result = await client.callTool({
      name: 'list_files',
      arguments: { workspaceId: '00000000-0000-0000-0000-000000000000' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('403');
  });

  it('scopes a file listing to the requested workspace', async () => {
    const calls: string[] = [];
    const client = await connect(apiWith(200, '[]', calls));

    await client.callTool({ name: 'list_files', arguments: { workspaceId: 'ws-42' } });

    expect(calls).toEqual(['http://octo.test/api/files?workspaceId=ws-42']);
  });

  it('creates a workspace and returns the one-time secret', async () => {
    const calls: string[] = [];
    const client = await connect(
      apiWith(201, '{"workspace":{"id":"w1"},"rawSecret":"octo_live_ws_secret"}', calls)
    );

    const result = await client.callTool({ name: 'create_workspace', arguments: { name: 'Project X' } });

    expect(calls).toEqual(['http://octo.test/api/workspaces']);
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain('octo_live_ws_secret');
  });

  it('mints a key against the keys route', async () => {
    const calls: string[] = [];
    const client = await connect(apiWith(201, '{"apiKey":{"id":"k1"},"rawSecret":"octo_live_ws_k"}', calls));

    const result = await client.callTool({
      name: 'mint_key',
      arguments: { name: 'project', workspaceId: 'w1', scopes: ['read', 'write', 'files'] },
    });

    expect(calls).toEqual(['http://octo.test/api/keys']);
    expect(result.isError).toBeFalsy();
  });

  it('downloads a file through the content route', async () => {
    const calls: string[] = [];
    const client = await connect(apiWith(200, 'bytes', calls));

    const result = await client.callTool({
      name: 'download_file',
      arguments: { workspaceId: 'w1', fileId: 'f1' },
    });

    expect(calls).toEqual(['http://octo.test/api/files/content?workspaceId=w1&fileId=f1']);
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe('"Ynl0ZXM="');
  });

  it('deletes a file through the file route', async () => {
    const calls: string[] = [];
    const client = await connect(apiWith(200, '{"success":true,"fileId":"f1"}', calls));

    const result = await client.callTool({
      name: 'delete_file',
      arguments: { workspaceId: 'w1', fileId: 'f1' },
    });

    expect(calls).toEqual(['http://octo.test/api/files/f1?workspaceId=w1']);
    expect(result.isError).toBeFalsy();
  });

  it('reports a delete refusal as a tool error', async () => {
    const client = await connect(apiWith(403, '{"error":"FORBIDDEN: delete scope required"}'));

    const result = await client.callTool({
      name: 'delete_file',
      arguments: { workspaceId: 'w1', fileId: 'f1' },
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('403');
  });
});
