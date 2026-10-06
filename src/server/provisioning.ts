/**
 * Provisioned Postgres per workspace (productization Slice 20).
 *
 * This module is the single grep-able boundary for the privileged connection that
 * can `CREATE DATABASE` and `CREATE ROLE` cluster-wide. The runtime roles cannot:
 * `octo_app` and `octo_service` are both `NOSUPERUSER NOCREATEDB NOCREATEROLE`
 * (slice14), so provisioning needs its own credential, `OCTO_ADMIN_URL`. Importing
 * this module is the grep-able signal that code holds that authority.
 *
 * Two properties shape the code below:
 *   - `CREATE DATABASE` cannot run inside a transaction, so each statement is
 *     autocommit and there is no rollback across them. The catalog row is written
 *     by the caller only after every statement here succeeds, so a failure leaves
 *     no catalog row; an orphaned role or database without a row is an
 *     owner-visible anomaly resolved by hand (no janitor in this slice).
 *   - `CREATE DATABASE` / `CREATE ROLE` accept no bind parameters. The only values
 *     interpolated are server-derived identifiers (validated against a strict
 *     pattern and quoted) and a generated password. Nothing from a request body
 *     reaches a statement in this file.
 */

import pg from 'pg';
import { randomBytes } from 'node:crypto';

const { Pool } = pg;

const adminUrl = process.env['OCTO_ADMIN_URL'] || '';

/**
 * The identifiers a provisioned database and its owning role are named from. The
 * slug is reduced to `[a-z0-9_]`, truncated so the longest result stays inside
 * Postgres's 63-byte identifier limit, and the suffix makes the name cluster-unique.
 */
const MAX_SLUG_PART = 40;
const IDENTIFIER_PATTERN = /^[a-z0-9_]+$/;

export function deriveDatabaseNames(slug: string, suffix: string): { dbName: string; roleName: string } {
  const base = slug.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, MAX_SLUG_PART) || 'ws';
  return { dbName: `octo_ws_${base}_${suffix}`, roleName: `octo_ws_${base}_${suffix}_rw` };
}

/** Doubles embedded quotes so an interpolated identifier cannot break out. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Doubles embedded quotes so an interpolated literal cannot break out. */
function quoteLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Fails closed if a generated name is not the shape this module produces. */
function assertSafeName(name: string): void {
  if (!IDENTIFIER_PATTERN.test(name) || name.length > 63) {
    throw new Error(`Unsafe generated database identifier: ${name}`);
  }
}

let adminPool: pg.Pool | null = null;

/** True when a privileged provisioning credential is configured. */
export function provisioningConfigured(): boolean {
  return Boolean(adminUrl);
}

function getAdminPool(): pg.Pool {
  if (!adminUrl) {
    throw new Error('PROVISIONING_NOT_CONFIGURED: OCTO_ADMIN_URL is not set');
  }
  if (!adminPool) {
    adminPool = new Pool({
      connectionString: adminUrl,
      max: 2,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    // An idle pooled client can error; without a listener Node rethrows it as an
    // uncaught exception and the single-process host exits.
    adminPool.on('error', (err) => {
      console.error('[provisioning] idle admin client error:', err.message);
    });
  }
  return adminPool;
}

/**
 * The host/port a client should use. Defaults to the admin connection's own
 * endpoint; a deployment that reaches Postgres at a different address for clients
 * (for example a published port, or a host the admin connection reaches by a
 * compose-internal name) overrides it here.
 */
function clientEndpoint(): { host: string; port: string } {
  const parsed = new URL(adminUrl);
  return {
    host: process.env['OCTO_DB_PUBLIC_HOST'] || parsed.hostname,
    port: process.env['OCTO_DB_PUBLIC_PORT'] || parsed.port || '5432',
  };
}

/** Builds the once-returned client connection string. */
export function buildConnectionString(roleName: string, password: string, dbName: string): string {
  const url = new URL(adminUrl);
  const { host, port } = clientEndpoint();
  url.username = roleName;
  url.password = password;
  url.hostname = host;
  url.port = port;
  url.pathname = `/${dbName}`;
  return url.toString();
}

export interface ProvisionedDatabase {
  dbName: string;
  roleName: string;
  password: string;
  connectionString: string;
}

/** How many fresh suffixes to try before giving up on a name collision. */
const MAX_NAME_ATTEMPTS = 5;

/**
 * Creates the role and database for a workspace and returns the client's
 * connection string. The caller writes the catalog row afterwards.
 *
 * The role is `NOSUPERUSER NOCREATEDB NOCREATEROLE` and owns only its own
 * database. `CONNECT` on that database is revoked from PUBLIC so only its owner
 * reaches it. The role can still open a session against the control database
 * (every role inherits PUBLIC's CONNECT there), but it holds no `USAGE` on the
 * `octo` schema and no table grants, so it can read and write no control-plane
 * data -- confinement there is privilege-based, not connection-based.
 */
export async function provisionDatabase(slug: string): Promise<ProvisionedDatabase> {
  const pool = getAdminPool();
  const client = await pool.connect();
  try {
    for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt += 1) {
      const suffix = randomBytes(4).toString('hex');
      const { dbName, roleName } = deriveDatabaseNames(slug, suffix);
      assertSafeName(dbName);
      assertSafeName(roleName);

      const taken = await client.query<{ taken: boolean }>(
        `SELECT (EXISTS(SELECT 1 FROM pg_database WHERE datname = $1)
               OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname = $2)) AS taken`,
        [dbName, roleName]
      );
      if (taken.rows[0]?.taken) continue;

      const password = randomBytes(24).toString('base64url');

      await client.query(
        `CREATE ROLE ${quoteIdent(roleName)} LOGIN PASSWORD ${quoteLiteral(password)} NOSUPERUSER NOCREATEDB NOCREATEROLE`
      );
      await client.query(`CREATE DATABASE ${quoteIdent(dbName)} OWNER ${quoteIdent(roleName)}`);
      await client.query(`REVOKE CONNECT ON DATABASE ${quoteIdent(dbName)} FROM PUBLIC`);
      await client.query(`GRANT CONNECT ON DATABASE ${quoteIdent(dbName)} TO ${quoteIdent(roleName)}`);

      return { dbName, roleName, password, connectionString: buildConnectionString(roleName, password, dbName) };
    }

    throw new Error(`NAME_COLLISION: could not derive a unique database name for slug '${slug}'`);
  } finally {
    client.release();
  }
}
