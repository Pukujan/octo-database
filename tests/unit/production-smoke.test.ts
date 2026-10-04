import { describe, expect, it, vi } from 'vitest';
import { runProductionSmoke } from '../../src/qa/production-smoke';

describe('production smoke checks', () => {
  it('checks health, frontend shell, referenced asset, and unauthenticated API refusal', async () => {
    const responses = new Map([
      ['https://octo.example/health', new Response(JSON.stringify({ status: 'ok', database: { connected: true }, r2: { connected: true } }), { status: 200, headers: { 'content-type': 'application/json' } })],
      ['https://octo.example/', new Response('<html><script type="module" src="/assets/app.js"></script></html>', { status: 200, headers: { 'content-type': 'text/html' } })],
      ['https://octo.example/assets/app.js', new Response('console.log(1)', { status: 200 })],
      ['https://octo.example/api/workspaces', new Response(JSON.stringify({ error: 'UNAUTHENTICATED' }), { status: 401, headers: { 'content-type': 'application/json' } })],
    ]);
    const requested: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      requested.push(url);
      const response = responses.get(url);
      if (!response) throw new Error(`unexpected request: ${url}`);
      return response;
    });

    await expect(runProductionSmoke('https://octo.example', fetchImpl)).resolves.toEqual({
      health: true,
      frontend: true,
      asset: true,
      unauthenticatedApi: true,
    });
    expect(requested).toEqual([
      'https://octo.example/health',
      'https://octo.example/',
      'https://octo.example/assets/app.js',
      'https://octo.example/api/workspaces',
    ]);
  });

  it('fails when the health payload reports a disconnected database', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      if (String(input) === 'https://octo.example/health') {
        return new Response(JSON.stringify({ status: 'ok', database: { connected: false } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected request: ${String(input)}`);
    });

    await expect(runProductionSmoke('https://octo.example', fetchImpl)).rejects.toThrow(/database/);
  });

  it('fails when the health payload reports a disconnected active store', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      if (String(input) === 'https://octo.example/health') {
        return new Response(
          JSON.stringify({ status: 'ok', database: { connected: true }, r2: { connected: false } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      throw new Error(`unexpected request: ${String(input)}`);
    });

    await expect(runProductionSmoke('https://octo.example', fetchImpl)).rejects.toThrow(/r2/);
  });
});
