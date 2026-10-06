/**
 * Runs the blind publish agent against the local API.
 * The script is not shown the publish implementation; it only speaks HTTP.
 */

import { spawn } from 'node:child_process';
import { expect, test } from '@playwright/test';

test('a blind agent publishes and unpublishes from capability discovery', async () => {
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, ['tests/blind/publish-public-file.mjs'], {
        cwd: process.cwd(),
        env: { ...process.env, OCTO_API_BASE: 'http://127.0.0.1:3001' },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    }
  );

  expect(`${result.stderr}\n${result.stdout}`).not.toContain('FAIL');
  expect(result.stdout).toContain('OK');
  expect(result.code).toBe(0);
});
