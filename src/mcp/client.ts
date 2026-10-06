/**
 * Thin HTTP client for the Octo API.
 *
 * The MCP adapter is a client of the same public API every other surface uses;
 * it holds no database or provider credentials and duplicates no server policy.
 * Authority comes entirely from the bearer token: an account-wide key
 * (`octo_live_acc_`) sees every workspace the principal belongs to, while a
 * workspace-scoped key (`octo_live_ws_`) is confined to its own workspace by the
 * server, so the adapter needs no extra checks of its own.
 */

export class OctoApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string
  ) {
    super(`Octo API request failed (${status}): ${body}`);
    this.name = 'OctoApiError';
  }
}

export interface OctoApiOptions {
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
}

export class OctoApi {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OctoApiOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    if (!response.ok) throw new OctoApiError(response.status, text);
    return text ? JSON.parse(text) : null;
  }

  me(): Promise<unknown> {
    return this.request('GET', '/api/me');
  }

  createWorkspace(input: {
    name: string;
    slug?: string;
    description?: string;
    retentionDays?: number;
  }): Promise<unknown> {
    return this.request('POST', '/api/workspaces', {
      name: input.name,
      ...(input.slug === undefined ? {} : { slug: input.slug }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.retentionDays === undefined ? {} : { retentionDays: input.retentionDays }),
    });
  }

  mintKey(input: {
    name: string;
    workspaceId?: string;
    scopes?: string[];
    expiresInDays?: number;
  }): Promise<unknown> {
    return this.request('POST', '/api/keys', {
      name: input.name,
      ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
      ...(input.scopes === undefined ? {} : { scopes: input.scopes }),
      ...(input.expiresInDays === undefined ? {} : { expiresInDays: input.expiresInDays }),
    });
  }

  listWorkspaces(): Promise<unknown> {
    return this.request('GET', '/api/workspaces');
  }

  provisionDatabase(input: { workspaceId: string }): Promise<unknown> {
    return this.request(
      'POST',
      `/api/workspaces/${encodeURIComponent(input.workspaceId)}/database`
    );
  }

  listFiles(workspaceId: string): Promise<unknown> {
    return this.request('GET', `/api/files?workspaceId=${encodeURIComponent(workspaceId)}`);
  }

  uploadFile(input: {
    workspaceId: string;
    name: string;
    data: string;
    mimeType?: string;
  }): Promise<unknown> {
    return this.request('POST', '/api/files/upload', {
      workspaceId: input.workspaceId,
      name: input.name,
      mimeType: input.mimeType ?? 'application/octet-stream',
      data: input.data,
      dataEncoding: 'base64',
    });
  }

  // The content route returns raw bytes, not JSON, so it bypasses request()'s
  // JSON parsing and returns the bytes base64-encoded for transport over MCP.
  private async getBytes(path: string): Promise<string> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) throw new OctoApiError(response.status, await response.text());
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.toString('base64');
  }

  downloadFile(input: { workspaceId: string; fileId: string }): Promise<string> {
    return this.getBytes(
      `/api/files/content?workspaceId=${encodeURIComponent(input.workspaceId)}&fileId=${encodeURIComponent(input.fileId)}`
    );
  }

  deleteFile(input: { workspaceId: string; fileId: string }): Promise<unknown> {
    return this.request(
      'DELETE',
      `/api/files/${encodeURIComponent(input.fileId)}?workspaceId=${encodeURIComponent(input.workspaceId)}`
    );
  }

  query(input: { workspaceId: string; query: string; limit?: number }): Promise<unknown> {
    return this.request('POST', '/api/rag/query', {
      workspaceId: input.workspaceId,
      query: input.query,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
  }
}
