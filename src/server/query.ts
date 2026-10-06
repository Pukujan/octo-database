/**
 * Workspace SQL execution (Slice 21).
 *
 * The one place client-authored SQL is run against a workspace's provisioned
 * database. It is a sibling of `provisioning.ts` on purpose: both are the
 * grep-able boundaries where a request reaches a real database, and the reason
 * this module exists is that the two must not be confused.
 *
 * It connects as the workspace's OWN role, with the workspace's own password --
 * never as the privileged provisioning credential. The provisioning connection is
 * a superuser; if client SQL ran there, the client's own statements could
 * `RESET ROLE` back to it and then reach every database in the cluster. Connecting
 * as the `NOSUPERUSER` role means the statements execute with exactly the
 * authority the workspace already has over its own database, and nothing else.
 *
 * Protocol choice, made by the server and never by the SQL text:
 *   - Parameters, or a read-only caller: the extended protocol, which Postgres
 *     restricts to a single statement. Read-only uses it so a second statement
 *     cannot escape the read-only transaction the server opened.
 *   - A write caller with no parameters: the simple protocol, so one request can
 *     carry a whole migration of several statements.
 *
 * Each request opens its own short-lived connection and closes it, so no session
 * state (a read-only transaction, a timeout) can leak to the next request.
 */

import pg from 'pg';
import { buildInternalConnectionString } from './provisioning';

const { Client, DatabaseError } = pg;

/** Default and maximum rows returned in one response. */
export const DEFAULT_ROW_LIMIT = 1000;
export const MAX_ROW_LIMIT = 10000;

/** Default cap on how long one request's statements may run. */
export const DEFAULT_STATEMENT_TIMEOUT_MS = 30000;

export interface WorkspaceQueryRequest {
  dbName: string;
  roleName: string;
  password: string;
  sql: string;
  params?: unknown[];
  /** True for a caller without the write scope; the server opens a read-only transaction. */
  readOnly: boolean;
  rowLimit: number;
  timeoutMs: number;
}

export interface WorkspaceQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  /** How many statements ran; the simple protocol may run several. */
  statementCount: number;
  truncated: boolean;
}

/** True for an error the statement itself raised (syntax, constraint, ...). */
export function isSqlError(err: unknown): boolean {
  return err instanceof DatabaseError;
}

/** The Postgres SQLSTATE for an error, when there is one. */
export function sqlState(err: unknown): string | undefined {
  return err instanceof DatabaseError ? err.code : undefined;
}

export async function runWorkspaceQuery(req: WorkspaceQueryRequest): Promise<WorkspaceQueryResult> {
  const client = new Client({
    connectionString: buildInternalConnectionString(req.roleName, req.password, req.dbName),
    connectionTimeoutMillis: 5000,
    // Server-side: bounds a runaway statement. Client-side: bounds the wait even if
    // the server never answers (a dropped connection mid-query).
    statement_timeout: req.timeoutMs,
    query_timeout: req.timeoutMs + 5000,
  });

  await client.connect();
  let opened = false;
  try {
    if (req.readOnly) {
      await client.query('BEGIN READ ONLY');
      opened = true;
    }

    const results = await execute(client, req);

    if (opened) {
      await client.query('COMMIT');
      opened = false;
    }

    // Report the last statement's result: for a batch of DDL that is the outcome
    // the caller is waiting on, and for a single statement it is the only one.
    const last = results[results.length - 1];
    const rows = (last?.rows ?? []) as Record<string, unknown>[];
    const truncated = rows.length > req.rowLimit;

    return {
      columns: (last?.fields ?? []).map((field) => field.name),
      rows: truncated ? rows.slice(0, req.rowLimit) : rows,
      rowCount: last?.rowCount ?? rows.length,
      statementCount: results.length,
      truncated,
    };
  } catch (err) {
    if (opened) await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function execute(client: pg.Client, req: WorkspaceQueryRequest): Promise<pg.QueryResult[]> {
  const parameterized = Array.isArray(req.params) && req.params.length > 0;

  if (parameterized || req.readOnly) {
    const single = await client.query({ text: req.sql, values: req.params ?? [] });
    return [single];
  }

  const result = await client.query({ text: req.sql });
  return Array.isArray(result) ? result : [result];
}
