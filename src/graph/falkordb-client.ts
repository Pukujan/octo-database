/**
 * FalkorDB graph client (issue #12, slice B).
 *
 * This module is the single grep-able boundary that talks to the graph engine. The
 * engine inherits none of the `octo.*` RLS fence -- it is outside the schema, outside
 * `octo_app`, and outside the request pipeline that binds `request.workspace_id` --
 * so per-workspace isolation is enforced *here*, not by the engine:
 *
 *   1. The graph name is derived from an authenticated workspace UUID
 *      (`graphNameForWorkspace`) and validated as a UUID before use. No caller passes
 *      a graph name, so no request body can name a graph.
 *   2. Only `roQuery` (GRAPH.RO_QUERY) is exposed, so a mediated call cannot write.
 *
 * There is no engine-side tenancy backstop: the single `requirepass` is an access
 * gate, not a per-tenant boundary, so a scoping bug here would be a silent
 * cross-workspace read. That is why the name is derived, never accepted.
 *
 * Configuration is optional, like the embedding provider: unset `OCTO_GRAPH_URL`
 * leaves the graph surface returning a clear "not configured" state rather than a
 * half-wired engine.
 */

import { FalkorDB, Graph } from 'falkordb';

export interface GraphConfig {
  url: string;
  /** Wall-clock ceiling for one mediated query, so a runaway read cannot pin a request. */
  queryTimeoutMs: number;
  /** Ceiling for establishing the connection, so a down engine fails fast. */
  connectTimeoutMs: number;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_QUERY_TIMEOUT_MS = 10_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
const GRAPH_NAME_PREFIX = 'octo_ws_';

/**
 * FalkorDB's error when the graph key does not exist. A workspace whose graph has
 * not been projected yet has no data, so a read against it returns no rows rather
 * than an error. The engine raises this before parsing the query, so while a graph
 * is empty a malformed query also reads as empty; once the graph exists (slice E)
 * every real failure -- bad Cypher, engine down -- propagates to the caller.
 */
const GRAPH_ABSENT_ERROR = 'Invalid graph operation on empty key';

/**
 * Loads graph configuration from the environment.
 * Returns null when unconfigured so callers can report a clear, non-fatal state.
 */
export function loadGraphConfigFromEnv(): GraphConfig | null {
  const url = process.env['OCTO_GRAPH_URL'];
  if (!url) return null;
  return {
    url,
    queryTimeoutMs: Number(process.env['OCTO_GRAPH_QUERY_TIMEOUT_MS'] ?? DEFAULT_QUERY_TIMEOUT_MS),
    connectTimeoutMs: Number(process.env['OCTO_GRAPH_CONNECT_TIMEOUT_MS'] ?? DEFAULT_CONNECT_TIMEOUT_MS),
  };
}

/**
 * Derives the graph name for a workspace. This is the whole isolation story: the
 * name comes from a UUID the server already authenticated, never from a request, and
 * a value that is not a UUID is refused rather than passed to the engine.
 */
export function graphNameForWorkspace(workspaceId: string): string {
  if (!UUID_PATTERN.test(workspaceId)) {
    throw new Error('INVALID_WORKSPACE_ID: a graph name is derived from a workspace UUID');
  }
  return `${GRAPH_NAME_PREFIX}${workspaceId.toLowerCase()}`;
}

export interface GraphQueryResult {
  /** One object per row, keyed by the query's RETURN column names. */
  rows: Array<Record<string, unknown>>;
  /** Engine metadata (execution time, cache state) for provenance. */
  metadata: string[];
}

/** A scalar query parameter, the only kind a read query needs. */
export type GraphParam = string | number | boolean | null;

/**
 * A write parameter. The projector passes lists of maps (UNWIND batches), so unlike
 * the read path this accepts structured JSON. Only the projector uses it, and it
 * builds the values from canonical rows -- no request value reaches it untyped.
 */
export type GraphWriteParam = null | string | number | boolean | GraphWriteParam[] | { [key: string]: GraphWriteParam };
export class GraphClient {
  private client: FalkorDB | null = null;
  private connecting: Promise<FalkorDB> | null = null;

  constructor(private readonly config: GraphConfig) {}

  /** Connects lazily and memoizes; a failed attempt is retried on the next call. */
  private async connection(): Promise<FalkorDB> {
    if (this.client) return this.client;
    if (!this.connecting) {
      this.connecting = FalkorDB.connect({
        url: this.config.url,
        socket: { connectTimeout: this.config.connectTimeoutMs },
      })
        .then((client) => {
          this.client = client;
          return client;
        })
        .catch((error) => {
          this.connecting = null;
          throw error;
        });
    }
    return this.connecting;
  }

  /**
   * Runs a read-only Cypher query against one workspace's graph. `workspaceId` must
   * be the authenticated workspace; the graph name is derived from it here.
   */
  async roQuery(
    workspaceId: string,
    cypher: string,
    params?: Record<string, GraphParam>
  ): Promise<GraphQueryResult> {
    const graphName = graphNameForWorkspace(workspaceId);
    const client = await this.connection();
    const graph: Graph = client.selectGraph(graphName);
    try {
      const reply = await graph.roQuery<Record<string, unknown>>(cypher, {
        ...(params ? { params } : {}),
        TIMEOUT: this.config.queryTimeoutMs,
      });
      return { rows: reply.data ?? [], metadata: reply.metadata ?? [] };
    } catch (error) {
      // An unprojected workspace reads as empty, not as an error. Every other
      // failure -- malformed Cypher, engine down -- propagates to the caller.
      if (error instanceof Error && error.message.includes(GRAPH_ABSENT_ERROR)) {
        return { rows: [], metadata: [] };
      }
      throw error;
    }
  }

  /**
   * Runs a read-write Cypher statement against one workspace's graph. Reserved for
   * the projector: no request body ever reaches this path, and the graph name is
   * still derived from the authenticated workspace, never accepted.
   */
  async rwQuery(
    workspaceId: string,
    cypher: string,
    params?: Record<string, unknown>
  ): Promise<void> {
    const graphName = graphNameForWorkspace(workspaceId);
    const client = await this.connection();
    const graph: Graph = client.selectGraph(graphName);
    await graph.query(cypher, {
      // The projector builds these from canonical rows, so the values are JSON.
      ...(params ? { params: params as Record<string, GraphWriteParam> } : {}),
      TIMEOUT: this.config.queryTimeoutMs,
    });
  }

  /**
   * Deletes one workspace's entire graph. This is the "destroy and rebuild" step:
   * the graph is a projection, so dropping it loses no canonical knowledge.
   */
  async deleteGraph(workspaceId: string): Promise<void> {
    const graphName = graphNameForWorkspace(workspaceId);
    const client = await this.connection();
    const graph: Graph = client.selectGraph(graphName);
    try {
      await graph.delete();
    } catch (error) {
      // Deleting a graph that was never created is a no-op, not a failure.
      if (error instanceof Error && error.message.includes(GRAPH_ABSENT_ERROR)) return;
      throw error;
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.connecting = null;
    if (client) await client.close();
  }
}
