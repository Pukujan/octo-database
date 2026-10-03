/**
 * The catalog insert is the second half of an upload. If it fails after bytes
 * have reached the local object store, the server removes those unreferenced
 * bytes instead of leaving an orphan behind.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { query } from '../../src/server/db';

const STORAGE_ROOT = '/tmp/octo-storage';

test('removes uploaded bytes when the file catalog insert fails', async ({ request }) => {
  test.skip(
    Boolean(process.env['S3_API_ENDPOINT'] || process.env['R2_ENDPOINT']),
    'This recovery assertion inspects the explicit local E2E object store.'
  );

  const guestResponse = await request.post('/api/auth/guest', {
    data: { displayName: `Upload rollback ${randomUUID()}` },
  });
  expect(guestResponse.status()).toBe(201);
  const guest = (await guestResponse.json()) as {
    sessionToken: string;
    workspace: { id: string };
  };
  const filename = `upload-rollback-fixture-${randomUUID()}.txt`;

  await query(`
    CREATE OR REPLACE FUNCTION octo.reject_upload_rollback_fixture()
    RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.name LIKE 'upload-rollback-fixture-%' THEN
        RAISE EXCEPTION 'simulated catalog write failure';
      END IF;
      RETURN NEW;
    END;
    $$
  `);
  await query(`DROP TRIGGER IF EXISTS reject_upload_rollback_fixture ON octo.files`);
  await query(`
    CREATE TRIGGER reject_upload_rollback_fixture
    BEFORE INSERT ON octo.files
    FOR EACH ROW EXECUTE FUNCTION octo.reject_upload_rollback_fixture()
  `);

  let uploadStatus: number;
  try {
    const upload = await request.post('/api/files/upload', {
      headers: { Authorization: `Bearer ${guest.sessionToken}` },
      data: {
        workspaceId: guest.workspace.id,
        name: filename,
        mimeType: 'text/plain',
        data: `uncommitted ${randomUUID()}`,
        dataEncoding: 'utf8',
      },
    });
    uploadStatus = upload.status();
  } finally {
    await query('DROP TRIGGER IF EXISTS reject_upload_rollback_fixture ON octo.files');
    await query('DROP FUNCTION IF EXISTS octo.reject_upload_rollback_fixture()');
  }

  expect(uploadStatus!).toBe(500);
  const files = await query<{ id: string }>(
    'SELECT id FROM octo.files WHERE workspace_id = $1 AND name = $2',
    [guest.workspace.id, filename]
  );
  expect(files).toHaveLength(0);

  const workspaceStorage = join(STORAGE_ROOT, 'workspaces', guest.workspace.id);
  const orphanExists = existsSync(workspaceStorage) &&
    readdirSync(workspaceStorage).some((fileDirectory) =>
      existsSync(join(workspaceStorage, fileDirectory, filename))
    );
  expect(orphanExists).toBe(false);
});
