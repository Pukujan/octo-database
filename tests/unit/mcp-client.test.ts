/**
 * Unit tests: the Octo API client behind the MCP adapter.
 *
 * The adapter must be a thin client of the public API: every call carries the
 * configured bearer token, targets the documented route, and surfaces a non-2xx
 * response as a typed error instead of a silent success. Authority (which
 * workspaces a token can touch) is the server's job, so these tests assert the
 * request the adapter sends, not any policy it might invent.
 */

import { describe, expect, it } from 'vitest';
import { OctoApi, OctoApiError } from '../../src/mcp/client';

interface Call {
  url: string;
  init: RequestInit;
}

function recordingFetch(status = 200, body = '{"ok":true}'): { impl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const impl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function authOf(call: Call): string | undefined {
  const headers = call.init.headers as Record<string, string>;
  return headers['Authorization'];
}

describe('OctoApi', () => {
  it('sends the bearer token on every request', async () => {
    const { impl, calls } = recordingFetch();
    const api = new OctoApi({ baseUrl: 'http://localhost:3001', token: 'octo_live_acc_x', fetchImpl: impl });

    await api.me();
    await api.listWorkspaces();

    expect(calls).toHaveLength(2);
    expect(calls.every((c) => authOf(c) === 'Bearer octo_live_acc_x')).toBe(true);
  });

  it('lists workspaces with a GET and no body', async () => {
    const { impl, calls } = recordingFetch();
    const api = new OctoApi({ baseUrl: 'http://localhost:3001', token: 't', fetchImpl: impl });

    await api.listWorkspaces();

    expect(calls[0]!.url).toBe('http://localhost:3001/api/workspaces');
    expect(calls[0]!.init.method).toBe('GET');
    expect(calls[0]!.init.body).toBeUndefined();
  });

  it('scopes a file listing to the requested workspace', async () => {
    const { impl, calls } = recordingFetch();
    const api = new OctoApi({ baseUrl: 'http://localhost:3001', token: 't', fetchImpl: impl });

    await api.listFiles('ws 1/2');

    expect(calls[0]!.url).toBe('http://localhost:3001/api/files?workspaceId=ws%201%2F2');
  });

  it('uploads a file as base64 with an explicit encoding', async () => {
    const { impl, calls } = recordingFetch();
    const api = new OctoApi({ baseUrl: 'http://localhost:3001', token: 't', fetchImpl: impl });

    await api.uploadFile({ workspaceId: 'w', name: 'a.txt', data: 'aGk=' });

    const body = JSON.parse(String(calls[0]!.init.body));
    expect(calls[0]!.url).toBe('http://localhost:3001/api/files/upload');
    expect(calls[0]!.init.method).toBe('POST');
    expect(body).toMatchObject({
      workspaceId: 'w',
      name: 'a.txt',
      data: 'aGk=',
      dataEncoding: 'base64',
      mimeType: 'application/octet-stream',
    });
  });

  it('queries a workspace without inventing a limit', async () => {
    const { impl, calls } = recordingFetch();
    const api = new OctoApi({ baseUrl: 'http://localhost:3001', token: 't', fetchImpl: impl });

    await api.query({ workspaceId: 'w', query: 'hello' });

    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ workspaceId: 'w', query: 'hello' });
  });

  it('creates a workspace without inventing optional fields', async () => {
    const { impl, calls } = recordingFetch(201, '{"workspace":{"id":"w"},"rawSecret":"octo_live_ws_x"}');
    const api = new OctoApi({ baseUrl: 'http://localhost:3001', token: 't', fetchImpl: impl });

    await api.createWorkspace({ name: 'Backups' });

    expect(calls[0]!.url).toBe('http://localhost:3001/api/workspaces');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ name: 'Backups' });
  });

  it('passes through the workspace fields it was given', async () => {
    const { impl, calls } = recordingFetch(201, '{}');
    const api = new OctoApi({ baseUrl: 'http://localhost:3001', token: 't', fetchImpl: impl });

    await api.createWorkspace({ name: 'Backups', slug: 'backups', description: 'nightly', retentionDays: 30 });

    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      name: 'Backups',
      slug: 'backups',
      description: 'nightly',
      retentionDays: 30,
    });
  });

  it('mints a workspace-scoped key against the keys route', async () => {
    const { impl, calls } = recordingFetch(201, '{"apiKey":{"id":"k"},"rawSecret":"octo_live_ws_x"}');
    const api = new OctoApi({ baseUrl: 'http://localhost:3001', token: 't', fetchImpl: impl });

    await api.mintKey({ name: 'project key', workspaceId: 'w', scopes: ['read', 'write', 'files', 'delete'] });

    expect(calls[0]!.url).toBe('http://localhost:3001/api/keys');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      name: 'project key',
      workspaceId: 'w',
      scopes: ['read', 'write', 'files', 'delete'],
    });
  });

  it('downloads a file as base64 of the raw bytes, not parsed JSON', async () => {
    const { impl, calls } = recordingFetch(200, 'hello bytes');
    const api = new OctoApi({ baseUrl: 'http://localhost:3001', token: 't', fetchImpl: impl });

    const data = await api.downloadFile({ workspaceId: 'w 1', fileId: 'f/2' });

    expect(calls[0]!.url).toBe('http://localhost:3001/api/files/content?workspaceId=w%201&fileId=f%2F2');
    expect(calls[0]!.init.method).toBe('GET');
    expect(data).toBe(Buffer.from('hello bytes').toString('base64'));
  });

  it('surfaces a failed download as a typed error', async () => {
    const { impl } = recordingFetch(404, '{"error":"FILE_NOT_FOUND"}');
    const api = new OctoApi({ baseUrl: 'http://localhost:3001', token: 't', fetchImpl: impl });

    await expect(api.downloadFile({ workspaceId: 'w', fileId: 'f' })).rejects.toMatchObject({
      status: 404,
      body: '{"error":"FILE_NOT_FOUND"}',
    });
  });

  it('deletes a file with the workspace in the query string', async () => {
    const { impl, calls } = recordingFetch(200, '{"success":true,"fileId":"f 1"}');
    const api = new OctoApi({ baseUrl: 'http://localhost:3001', token: 't', fetchImpl: impl });

    await api.deleteFile({ workspaceId: 'w 1', fileId: 'f 1' });

    expect(calls[0]!.url).toBe('http://localhost:3001/api/files/f%201?workspaceId=w%201');
    expect(calls[0]!.init.method).toBe('DELETE');
  });

  it('surfaces a non-2xx response as a typed error, not a silent success', async () => {
    const { impl } = recordingFetch(403, '{"error":"FORBIDDEN"}');
    const api = new OctoApi({ baseUrl: 'http://localhost:3001', token: 't', fetchImpl: impl });

    await expect(api.listWorkspaces()).rejects.toBeInstanceOf(OctoApiError);
    await expect(api.listWorkspaces()).rejects.toMatchObject({ status: 403, body: '{"error":"FORBIDDEN"}' });
  });

  it('normalizes a trailing slash on the base URL', async () => {
    const { impl, calls } = recordingFetch();
    const api = new OctoApi({ baseUrl: 'http://localhost:3001/', token: 't', fetchImpl: impl });

    await api.me();

    expect(calls[0]!.url).toBe('http://localhost:3001/api/me');
  });

  it('returns null for an empty response body', async () => {
    const { impl } = recordingFetch(200, '');
    const api = new OctoApi({ baseUrl: 'http://localhost:3001', token: 't', fetchImpl: impl });

    await expect(api.me()).resolves.toBeNull();
  });
});
