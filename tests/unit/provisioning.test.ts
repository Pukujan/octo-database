/**
 * Unit tests: provisioned-database naming and connection-string construction.
 *
 * `CREATE DATABASE` and `CREATE ROLE` accept no bind parameters, so these names are
 * interpolated into DDL. The properties that make that safe are pinned here: every
 * generated identifier is a plain `[a-z0-9_]` token inside Postgres's 63-byte
 * limit, whatever the workspace slug contains, and the returned connection string
 * addresses the provisioned database and role rather than the control plane.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const SUFFIX = 'ab12cd34';

async function freshModule(): Promise<typeof import('../../src/server/provisioning')> {
  vi.resetModules();
  return import('../../src/server/provisioning');
}

describe('deriveDatabaseNames', () => {
  it('derives a distinct database and role from the slug and suffix', async () => {
    const { deriveDatabaseNames } = await freshModule();
    const { dbName, roleName } = deriveDatabaseNames('my-project', SUFFIX);
    expect(dbName).toBe(`octo_ws_my_project_${SUFFIX}`);
    expect(roleName).toBe(`octo_ws_my_project_${SUFFIX}_rw`);
    expect(dbName).not.toBe(roleName);
  });

  it('is deterministic for the same slug and suffix', async () => {
    const { deriveDatabaseNames } = await freshModule();
    expect(deriveDatabaseNames('alpha', SUFFIX)).toEqual(deriveDatabaseNames('alpha', SUFFIX));
  });

  it('produces different names for different suffixes', async () => {
    const { deriveDatabaseNames } = await freshModule();
    expect(deriveDatabaseNames('alpha', 'aaaaaaaa').dbName).not.toBe(
      deriveDatabaseNames('alpha', 'bbbbbbbb').dbName
    );
  });

  it('reduces an adversarial slug to a safe identifier', async () => {
    const { deriveDatabaseNames } = await freshModule();
    const { dbName, roleName } = deriveDatabaseNames('Weird"Slug\'; DROP--', SUFFIX);
    for (const name of [dbName, roleName]) {
      expect(name).toMatch(/^[a-z0-9_]+$/);
      expect(name).not.toContain('"');
      expect(name).not.toContain("'");
    }
  });

  it('stays inside the 63-byte identifier limit for a very long slug', async () => {
    const { deriveDatabaseNames } = await freshModule();
    const { dbName, roleName } = deriveDatabaseNames('x'.repeat(300), SUFFIX);
    expect(dbName.length).toBeLessThanOrEqual(63);
    expect(roleName.length).toBeLessThanOrEqual(63);
  });

  it('falls back to a base name when the slug has no usable characters', async () => {
    const { deriveDatabaseNames } = await freshModule();
    const { dbName } = deriveDatabaseNames('!!!', SUFFIX);
    expect(dbName).toBe(`octo_ws_ws_${SUFFIX}`);
  });
});

describe('provisioning configuration', () => {
  const original = process.env['OCTO_ADMIN_URL'];
  const originalHost = process.env['OCTO_DB_PUBLIC_HOST'];
  const originalPort = process.env['OCTO_DB_PUBLIC_PORT'];

  afterEach(() => {
    if (original === undefined) delete process.env['OCTO_ADMIN_URL'];
    else process.env['OCTO_ADMIN_URL'] = original;
    if (originalHost === undefined) delete process.env['OCTO_DB_PUBLIC_HOST'];
    else process.env['OCTO_DB_PUBLIC_HOST'] = originalHost;
    if (originalPort === undefined) delete process.env['OCTO_DB_PUBLIC_PORT'];
    else process.env['OCTO_DB_PUBLIC_PORT'] = originalPort;
  });

  it('reports unconfigured when OCTO_ADMIN_URL is unset', async () => {
    delete process.env['OCTO_ADMIN_URL'];
    const { provisioningConfigured } = await freshModule();
    expect(provisioningConfigured()).toBe(false);
  });

  it('reports configured when OCTO_ADMIN_URL is set', async () => {
    process.env['OCTO_ADMIN_URL'] = 'postgresql://postgres:pw@octo-db:5432/postgres';
    const { provisioningConfigured } = await freshModule();
    expect(provisioningConfigured()).toBe(true);
  });

  it('addresses the provisioned database and role, not the control database', async () => {
    process.env['OCTO_ADMIN_URL'] = 'postgresql://postgres:pw@octo-db:5432/postgres';
    const { buildConnectionString } = await freshModule();
    const url = new URL(buildConnectionString('octo_ws_a_ab12cd34_rw', 's3cret', 'octo_ws_a_ab12cd34'));
    expect(url.username).toBe('octo_ws_a_ab12cd34_rw');
    expect(url.pathname).toBe('/octo_ws_a_ab12cd34');
    expect(url.hostname).toBe('octo-db');
    expect(url.port).toBe('5432');
  });

  it('honours a public host and port override for clients', async () => {
    process.env['OCTO_ADMIN_URL'] = 'postgresql://postgres:pw@octo-db:5432/postgres';
    process.env['OCTO_DB_PUBLIC_HOST'] = 'db.example.com';
    process.env['OCTO_DB_PUBLIC_PORT'] = '54329';
    const { buildConnectionString } = await freshModule();
    const url = new URL(buildConnectionString('octo_ws_a_ab12cd34_rw', 's3cret', 'octo_ws_a_ab12cd34'));
    expect(url.hostname).toBe('db.example.com');
    expect(url.port).toBe('54329');
  });
});
