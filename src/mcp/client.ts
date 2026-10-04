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

  listWorkspaces(): Promise<unknown> {
    return this.request('GET', '/api/workspaces');
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

  query(input: { workspaceId: string; query: string; limit?: number }): Promise<unknown> {
    return this.request('POST', '/api/rag/query', {
      workspaceId: input.workspaceId,
      query: input.query,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
  }
}
