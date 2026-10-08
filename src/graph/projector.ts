/**
 * Graph projector (issue #12, slice C).
 *
 * PostgreSQL is canonical; the graph is a rebuildable read model of the epistemic
 * ledger. This module turns canonical rows into a FalkorDB graph, and its only
 * contract is that a rebuild from the same canonical rows yields the same graph --
 * the graph carries no state a rebuild cannot reproduce.
 *
 * The shape is deliberately destroy-and-rebuild rather than incremental: the ledger
 * is append-only and per-workspace graphs are small, so "delete, then write" is both
 * simpler and always correct, where an incremental path would have to reason about
 * revisions, supersessions, and deletes that the ledger never performs.
 *
 * The graph name is derived from the workspace by the client, never accepted here, so
 * a projection cannot name another workspace's graph.
 */

import type { GraphClient } from './falkordb-client';

/** Bumped when the node/edge shape changes; stored so staleness is visible. */
export const GRAPH_SCHEMA_VERSION = '1';

/** The labels whose `id` the projector MERGEs and MATCHes on. */
const INDEXED_LABELS = ['Entity', 'Claim', 'Evidence', 'Perspective', 'Belief'] as const;

export interface ProjectionInput {
  entities: Array<{ id: string; name: string; entityType: string }>;
  claims: Array<{
    id: string;
    statement: string;
    subjectEntityId: string | null;
    validFrom: string;
    validTo: string | null;
    recordedAt: string;
    supersededAt: string | null;
    provenance: Record<string, unknown>;
  }>;
  evidence: Array<{
    id: string;
    locator: string | null;
    quote: string | null;
    contentHash: string | null;
    sourceFileId: string | null;
  }>;
  perspectives: Array<{ id: string; name: string }>;
  beliefs: Array<{
    id: string;
    perspectiveId: string;
    claimId: string;
    stance: string;
    confidence: number | null;
    validFrom: string;
    validTo: string | null;
    recordedAt: string;
    supersededAt: string | null;
  }>;
  claimRelations: Array<{
    id: string;
    fromClaimId: string;
    toClaimId: string;
    relation: string;
    recordedAt: string;
    supersededAt: string | null;
  }>;
  claimEvidence: Array<{ id: string; claimId: string; evidenceId: string; stance: string }>;
}

export interface ProjectionCounts {
  entityCount: number;
  claimCount: number;
  evidenceCount: number;
  relationCount: number;
}

/** Turns each canonical list into UNWIND batches of maps the client can pass. */
function batches<T>(rows: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/**
 * Graph properties hold only primitives, so every row is flattened before it is
 * sent: `pg` hands back timestamps as `Date` objects and provenance as an object,
 * neither of which the engine accepts.
 */
function graphRows(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (value instanceof Date) out[key] = value.toISOString();
      else if (value !== null && typeof value === 'object') out[key] = JSON.stringify(value);
      else out[key] = value;
    }
    return out;
  });
}

/**
 * Rebuilds one workspace's graph from canonical rows. Deletes the existing graph
 * first, so a partially-written prior projection cannot survive, then writes nodes
 * and edges. Returns the projected counts for the health row.
 */
export async function projectWorkspaceGraph(
  client: GraphClient,
  workspaceId: string,
  data: ProjectionInput
): Promise<ProjectionCounts> {
  await client.deleteGraph(workspaceId);

  // Index the `id` the projector MERGEs and MATCHes on. Without an index every MERGE
  // scans the whole label, making a rebuild quadratic in the workspace's row count.
  // The graph was just deleted, so no index exists yet -- a rebuild always starts
  // from a clean graph, so these never collide with an existing index.
  for (const label of INDEXED_LABELS) {
    await client.rwQuery(workspaceId, `CREATE INDEX FOR (n:${label}) ON (n.id)`);
  }

  for (const chunk of batches(data.entities)) {
    await client.rwQuery(
      workspaceId,
      `UNWIND $rows AS row
       MERGE (e:Entity {id: row.id})
       SET e.name = row.name, e.entityType = row.entityType`,
      { rows: graphRows(chunk) }
    );
  }

  for (const chunk of batches(data.claims)) {
    await client.rwQuery(
      workspaceId,
      `UNWIND $rows AS row
       MERGE (c:Claim {id: row.id})
       SET c.statement = row.statement,
           c.validFrom = row.validFrom,
           c.validTo = row.validTo,
           c.recordedAt = row.recordedAt,
           c.supersededAt = row.supersededAt,
           c.provenance = row.provenance`,
      { rows: graphRows(chunk) }
    );
  }

  for (const chunk of batches(data.evidence)) {
    await client.rwQuery(
      workspaceId,
      `UNWIND $rows AS row
       MERGE (v:Evidence {id: row.id})
       SET v.locator = row.locator, v.quote = row.quote,
           v.contentHash = row.contentHash, v.sourceFileId = row.sourceFileId`,
      { rows: graphRows(chunk) }
    );
  }

  for (const chunk of batches(data.perspectives)) {
    await client.rwQuery(
      workspaceId,
      `UNWIND $rows AS row
       MERGE (p:Perspective {id: row.id})
       SET p.name = row.name`,
      { rows: graphRows(chunk) }
    );
  }

  for (const chunk of batches(data.beliefs)) {
    await client.rwQuery(
      workspaceId,
      `UNWIND $rows AS row
       MERGE (b:Belief {id: row.id})
       SET b.stance = row.stance, b.confidence = row.confidence,
           b.validFrom = row.validFrom, b.validTo = row.validTo,
           b.recordedAt = row.recordedAt, b.supersededAt = row.supersededAt`,
      { rows: graphRows(chunk) }
    );
  }

  // Claim -> subject entity.
  const subjects = data.claims.filter((c) => c.subjectEntityId);
  for (const chunk of batches(subjects)) {
    await client.rwQuery(
      workspaceId,
      `UNWIND $rows AS row
       MATCH (c:Claim {id: row.claimId}), (e:Entity {id: row.entityId})
       MERGE (c)-[:SUBJECT]->(e)`,
      { rows: chunk.map((c) => ({ claimId: c.id, entityId: c.subjectEntityId })) }
    );
  }

  // Belief -> claim and belief -> perspective.
  for (const chunk of batches(data.beliefs)) {
    await client.rwQuery(
      workspaceId,
      `UNWIND $rows AS row
       MATCH (b:Belief {id: row.id}), (c:Claim {id: row.claimId})
       MERGE (b)-[:ABOUT]->(c)`,
      { rows: chunk.map((b) => ({ id: b.id, claimId: b.claimId })) }
    );
    await client.rwQuery(
      workspaceId,
      `UNWIND $rows AS row
       MATCH (b:Belief {id: row.id}), (p:Perspective {id: row.perspectiveId})
       MERGE (b)-[:HELD_BY]->(p)`,
      { rows: chunk.map((b) => ({ id: b.id, perspectiveId: b.perspectiveId })) }
    );
  }

  // Claim -[CITES {stance}]-> Evidence.
  for (const chunk of batches(data.claimEvidence)) {
    await client.rwQuery(
      workspaceId,
      `UNWIND $rows AS row
       MATCH (c:Claim {id: row.claimId}), (v:Evidence {id: row.evidenceId})
       MERGE (c)-[r:CITES {stance: row.stance}]->(v)`,
      { rows: graphRows(chunk) }
    );
  }

  // Claim -[RELATES {relation}]-> Claim.
  for (const chunk of batches(data.claimRelations)) {
    await client.rwQuery(
      workspaceId,
      `UNWIND $rows AS row
       MATCH (a:Claim {id: row.fromClaimId}), (b:Claim {id: row.toClaimId})
       MERGE (a)-[r:RELATES {relation: row.relation}]->(b)`,
      { rows: graphRows(chunk) }
    );
  }

  return {
    entityCount: data.entities.length,
    claimCount: data.claims.length,
    evidenceCount: data.evidence.length,
    relationCount: data.claimRelations.length,
  };
}
