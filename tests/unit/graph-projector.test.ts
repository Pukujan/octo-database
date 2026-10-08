/**
 * Unit tests for the graph projector (issue #12).
 *
 * The projector's contract is that a rebuild from the same canonical rows yields the
 * same graph. Its Cypher is exercised end-to-end against a live FalkorDB elsewhere;
 * what is worth pinning here are the two properties that make a write succeed at all --
 * the graph is deleted and its indexes created on the fresh graph before any node is
 * merged, and every property value is flattened to a primitive, since the engine
 * rejects nested maps and `pg` hands back timestamps as `Date` objects.
 */

import { describe, expect, it } from 'vitest';
import { GRAPH_SCHEMA_VERSION, ProjectionInput, projectWorkspaceGraph } from '../../src/graph/projector';
import type { GraphClient } from '../../src/graph/falkordb-client';

const WORKSPACE = '11111111-1111-1111-1111-111111111111';

interface Call {
  cypher: string;
  params?: Record<string, unknown>;
}

/** Records the Cypher and params the projector issues, in order. */
function recordingClient(): { client: GraphClient; calls: Call[]; deletes: () => number } {
  const calls: Call[] = [];
  let deletes = 0;
  const client = {
    deleteGraph: async () => {
      deletes += 1;
    },
    rwQuery: async (_workspaceId: string, cypher: string, params?: Record<string, unknown>) => {
      calls.push({ cypher, params });
    },
  } as unknown as GraphClient;
  return { client, calls, deletes: () => deletes };
}

const LEDGER: ProjectionInput = {
  entities: [{ id: 'e-1', name: 'Policy', entityType: 'policy' }],
  claims: [
    {
      id: 'c-1',
      statement: 'A claim.',
      subjectEntityId: 'e-1',
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: null,
      recordedAt: '2026-01-01T00:00:00.000Z',
      supersededAt: null,
      provenance: { run: 'r-1' },
    },
  ],
  evidence: [{ id: 'v-1', locator: null, quote: null, contentHash: null, sourceFileId: null }],
  perspectives: [{ id: 'p-1', name: 'Analyst' }],
  beliefs: [
    {
      id: 'b-1',
      perspectiveId: 'p-1',
      claimId: 'c-1',
      stance: 'believes',
      confidence: 0.9,
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: null,
      recordedAt: '2026-01-01T00:00:00.000Z',
      supersededAt: null,
    },
  ],
  claimRelations: [
    {
      id: 'r-1',
      fromClaimId: 'c-1',
      toClaimId: 'c-1',
      relation: 'supports',
      recordedAt: '2026-01-01T00:00:00.000Z',
      supersededAt: null,
    },
  ],
  claimEvidence: [{ id: 'ce-1', claimId: 'c-1', evidenceId: 'v-1', stance: 'supports' }],
};

describe('Graph projector', () => {
  it('deletes the graph, then indexes the merge keys before writing nodes', async () => {
    const { client, calls, deletes } = recordingClient();

    await projectWorkspaceGraph(client, WORKSPACE, LEDGER);

    expect(deletes()).toBe(1);
    const indexCalls = calls.filter((c) => c.cypher.startsWith('CREATE INDEX'));
    expect(indexCalls.map((c) => c.cypher)).toEqual([
      'CREATE INDEX FOR (n:Entity) ON (n.id)',
      'CREATE INDEX FOR (n:Claim) ON (n.id)',
      'CREATE INDEX FOR (n:Evidence) ON (n.id)',
      'CREATE INDEX FOR (n:Perspective) ON (n.id)',
      'CREATE INDEX FOR (n:Belief) ON (n.id)',
    ]);
    // Every index is created before the first node MERGE.
    const firstMerge = calls.findIndex((c) => c.cypher.includes('MERGE'));
    expect(firstMerge).toBeGreaterThanOrEqual(indexCalls.length);
  });

  it('flattens timestamps and provenance to primitives the engine accepts', async () => {
    const { client, calls } = recordingClient();

    await projectWorkspaceGraph(client, WORKSPACE, LEDGER);

    const claimWrite = calls.find((c) => c.cypher.includes('MERGE (c:Claim'));
    const rows = claimWrite?.params?.['rows'] as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    // The ledger hands `recordedAt` as a Date (pg's timestamptz) and provenance as an
    // object; both are rejected as graph properties, so they must arrive flattened.
    expect(rows[0]!['recordedAt']).toBe('2026-01-01T00:00:00.000Z');
    expect(rows[0]!['provenance']).toBe(JSON.stringify({ run: 'r-1' }));
  });

  it('reports the projected counts', async () => {
    const { client } = recordingClient();

    const counts = await projectWorkspaceGraph(client, WORKSPACE, LEDGER);

    expect(counts).toEqual({ entityCount: 1, claimCount: 1, evidenceCount: 1, relationCount: 1 });
    expect(GRAPH_SCHEMA_VERSION).toBe('1');
  });
});
