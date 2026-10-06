/**
 * Unit tests: the FalkorDB graph client (issue #12, slice B).
 *
 * The engine is mocked so the tests can assert the isolation contract without a
 * running FalkorDB: the graph name is derived from a workspace UUID, only the
 * read-only path is used, and a non-UUID workspace is refused before the engine is
 * touched. A live engine is exercised by the mediated-route eval in slice C.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('falkordb', () => ({ FalkorDB: { connect: mocks.connect } }));

import {
  GraphClient,
  graphNameForWorkspace,
  loadGraphConfigFromEnv,
} from '../../src/graph/falkordb-client';

const WORKSPACE_ID = '3f1c9a2e-6b4d-4f8a-9c1e-2d7b5a0e4c33';

function fakeClient(roQuery: ReturnType<typeof vi.fn>) {
  const selectGraph = vi.fn(() => ({ roQuery }));
  return { selectGraph, close: vi.fn(async () => {}) };
}

beforeEach(() => {
  mocks.connect.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('graph name derivation', () => {
  it('derives a stable, prefixed name from a workspace UUID', () => {
    expect(graphNameForWorkspace(WORKSPACE_ID)).toBe(`octo_ws_${WORKSPACE_ID}`);
    // Case is normalized so the same workspace never names two graphs.
    expect(graphNameForWorkspace(WORKSPACE_ID.toUpperCase())).toBe(`octo_ws_${WORKSPACE_ID}`);
  });

  it('refuses anything that is not a UUID, so no request value can name a graph', () => {
    for (const bad of ['', 'not-a-uuid', '../../other', 'octo_ws_' + WORKSPACE_ID, '1;2']) {
      expect(() => graphNameForWorkspace(bad)).toThrow(/INVALID_WORKSPACE_ID/);
    }
  });
});

describe('configuration', () => {
  it('is null when OCTO_GRAPH_URL is unset, so the surface reports not-configured', () => {
    vi.stubEnv('OCTO_GRAPH_URL', '');
    expect(loadGraphConfigFromEnv()).toBeNull();
  });

  it('reads the url and timeouts when configured', () => {
    vi.stubEnv('OCTO_GRAPH_URL', 'redis://:pw@octo-graph:6379');
    vi.stubEnv('OCTO_GRAPH_QUERY_TIMEOUT_MS', '2500');
    vi.stubEnv('OCTO_GRAPH_CONNECT_TIMEOUT_MS', '1500');
    expect(loadGraphConfigFromEnv()).toEqual({
      url: 'redis://:pw@octo-graph:6379',
      queryTimeoutMs: 2500,
      connectTimeoutMs: 1500,
    });
  });
});

describe('mediated read', () => {
  it('selects the workspace-derived graph and uses the read-only path', async () => {
    const roQuery = vi.fn(async () => ({ data: [{ n: 1 }], metadata: ['Cached execution: 0'] }));
    const client = fakeClient(roQuery);
    mocks.connect.mockResolvedValue(client);

    const graph = new GraphClient({
      url: 'redis://:pw@octo-graph:6379',
      queryTimeoutMs: 9000,
      connectTimeoutMs: 5000,
    });

    const result = await graph.roQuery(WORKSPACE_ID, 'MATCH (n) RETURN n', { limit: 1 });

    expect(client.selectGraph).toHaveBeenCalledWith(`octo_ws_${WORKSPACE_ID}`);
    expect(roQuery).toHaveBeenCalledWith('MATCH (n) RETURN n', {
      params: { limit: 1 },
      TIMEOUT: 9000,
    });
    expect(result).toEqual({ rows: [{ n: 1 }], metadata: ['Cached execution: 0'] });
  });

  it('refuses a non-UUID workspace before connecting to the engine', async () => {
    const graph = new GraphClient({
      url: 'redis://:pw@octo-graph:6379',
      queryTimeoutMs: 9000,
      connectTimeoutMs: 5000,
    });

    await expect(graph.roQuery('not-a-uuid', 'MATCH (n) RETURN n')).rejects.toThrow(
      /INVALID_WORKSPACE_ID/
    );
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('retries the connection after a failure instead of staying poisoned', async () => {
    const roQuery = vi.fn(async () => ({ data: [], metadata: [] }));
    const client = fakeClient(roQuery);
    mocks.connect.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValue(client);

    const graph = new GraphClient({
      url: 'redis://:pw@octo-graph:6379',
      queryTimeoutMs: 9000,
      connectTimeoutMs: 5000,
    });

    await expect(graph.roQuery(WORKSPACE_ID, 'RETURN 1')).rejects.toThrow(/ECONNREFUSED/);
    await expect(graph.roQuery(WORKSPACE_ID, 'RETURN 1')).resolves.toEqual({
      rows: [],
      metadata: [],
    });
    expect(mocks.connect).toHaveBeenCalledTimes(2);
  });

  it('reads an unprojected workspace as empty rather than as an error', async () => {
    const roQuery = vi.fn(async () => {
      throw new Error('ERR Invalid graph operation on empty key');
    });
    mocks.connect.mockResolvedValue(fakeClient(roQuery));

    const graph = new GraphClient({
      url: 'redis://:pw@octo-graph:6379',
      queryTimeoutMs: 9000,
      connectTimeoutMs: 5000,
    });

    await expect(graph.roQuery(WORKSPACE_ID, 'MATCH (n) RETURN n')).resolves.toEqual({
      rows: [],
      metadata: [],
    });
  });

  it('propagates a real query failure, not just a missing graph', async () => {
    const roQuery = vi.fn(async () => {
      throw new Error("Invalid input 'THIS': expected end of input");
    });
    mocks.connect.mockResolvedValue(fakeClient(roQuery));

    const graph = new GraphClient({
      url: 'redis://:pw@octo-graph:6379',
      queryTimeoutMs: 9000,
      connectTimeoutMs: 5000,
    });

    await expect(graph.roQuery(WORKSPACE_ID, 'THIS IS NOT CYPHER')).rejects.toThrow(
      /Invalid input/
    );
  });
});
