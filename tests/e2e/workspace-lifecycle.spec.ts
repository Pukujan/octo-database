/**
 * Playwright E2E & Vision: Workspace data plane (Slice 13)
 *
 * Exercises the workspace lifecycle in a real browser against the live server
 * and database, and asserts the metamorphic relations that only a running
 * system can show:
 *
 *   MR-1  Idempotent create: a duplicate create leaves exactly one workspace.
 *   MR-3  Workspace pinning: a workspace key cannot touch another workspace.
 *   MR-7  Confirmation gate: an API-key caller can never delete a workspace.
 *
 * Plus the golden path: create workspace -> auto-provisioned key shown ->
 * upload -> archive -> restore -> delete. The archive leg runs wherever the
 * cold tier is configured; where it is not (CI has no Drive credentials), the
 * route's documented 503 contract is asserted instead, so the test proves the
 * boundary either way.
 */

import { expect, Page, test } from '@playwright/test';
import { auditPage } from './vision-audit';

/** Selects a workspace by name from the dashboard's workspace switcher. */
async function selectWorkspace(page: Page, name: string): Promise<void> {
  await page.getByRole('combobox').first().click();
  await page.getByRole('option', { name: new RegExp(name) }).click();
}

test.describe('Workspace data plane', () => {
  test('create workspace, reveal its key, and drive a file through the tiers', async ({ page }) => {
    test.setTimeout(180000);
    await page.goto('/');
    await page.click('text=Continue as Guest');
    await expect(page.locator('text=Workspace Control Dashboard')).toBeVisible();

    // 1. Create a workspace from the UI; a key is auto-provisioned and shown once.
    await page.click('button:has-text("New Workspace")');
    await expect(page.getByRole('dialog').getByText('New Workspace')).toBeVisible();
    const wsName = `Lifecycle ${Date.now()}`;
    await page.getByRole('dialog').locator('input').first().fill(wsName);
    await page.getByRole('dialog').getByRole('button', { name: 'Create Workspace' }).click();

    // 2. The one-time secret dialog appears carrying a workspace key.
    await expect(page.getByRole('dialog').getByText('Workspace created')).toBeVisible();
    await expect(page.getByRole('dialog').getByText(/octo_live_ws_/)).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click();

    const wsId = await page.evaluate(async (name: string) => {
      const token = localStorage.getItem('octo_token');
      const list = await (
        await fetch('/api/workspaces', { headers: { Authorization: `Bearer ${token}` } })
      ).json();
      return (list as { id: string; name: string }[]).find((w) => w.name === name)!.id;
    }, wsName);

    // 3. Switch to the new workspace and upload a file.
    await selectWorkspace(page, wsName);
    await page.fill('input[placeholder="notes.txt"]', 'lifecycle.txt');
    await page.fill('input[placeholder="File body content..."]', 'round-trip payload');
    await page.click('button:has-text("Upload Text File")');
    await expect(page.getByRole('cell', { name: 'lifecycle.txt', exact: true })).toBeVisible();

    // 4. Archive it: queue the job and run the worker.
    const archiveStatus = await page.evaluate(async (workspaceId: string) => {
      const token = localStorage.getItem('octo_token');
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
      const files = await (await fetch(`/api/files?workspaceId=${workspaceId}`, { headers })).json();
      const file = files.find((f: { name: string }) => f.name === 'lifecycle.txt');
      const res = await fetch(`/api/files/${file.id}/archive?workspaceId=${workspaceId}`, {
        method: 'POST',
        headers,
      });
      if (!res.ok) return res.status;
      await fetch(`/api/jobs/run?workspaceId=${workspaceId}`, { method: 'POST', headers });
      return 202;
    }, wsId);

    if (archiveStatus === 202) {
      // Cold tier configured: the file moves to Drive and back. Reload first so
      // the workspace switcher resets to the guest workspace, making the
      // re-selection below fire a refresh of the new workspace's file list.
      await page.reload();
      await selectWorkspace(page, wsName);
      await expect(page.getByText('Drive (Cold)').first()).toBeVisible({ timeout: 30000 });

      const restoreStatus = await page.evaluate(async (workspaceId: string) => {
        const token = localStorage.getItem('octo_token');
        const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
        const files = await (await fetch(`/api/files?workspaceId=${workspaceId}`, { headers })).json();
        const file = files.find((f: { name: string }) => f.name === 'lifecycle.txt');
        const res = await fetch(`/api/files/${file.id}/restore?workspaceId=${workspaceId}`, {
          method: 'POST',
          headers,
        });
        await fetch(`/api/jobs/run?workspaceId=${workspaceId}`, { method: 'POST', headers });
        return res.status;
      }, wsId);
      expect(restoreStatus).toBe(202);

      await page.reload();
      await selectWorkspace(page, wsName);
      await expect(page.getByText('Active').first()).toBeVisible({ timeout: 30000 });
    } else {
      // Cold tier absent (CI): the route fails closed with a clear contract.
      expect(archiveStatus).toBe(503);
    }

    // 5. Vision audit of the workspace control surface with the new panels.
    const vision = await auditPage(page, 'Workspace Data Plane');
    if (vision) {
      expect(vision.passed).toBe(true);
      expect(vision.score).toBeGreaterThanOrEqual(75);
    }

    // 6. Delete the workspace through the confirmation-secret gate.
    await page.click('button:has-text("Delete Workspace")');
    await expect(page.getByRole('dialog').getByText('Delete Workspace').first()).toBeVisible();

    // First run: no secret is set, so the dialog prompts to create one.
    const setupField = page.getByRole('dialog').getByLabel(/New confirmation secret/);
    if (await setupField.isVisible().catch(() => false)) {
      await setupField.fill('e2e-confirm-secret');
      await page.getByRole('dialog').getByRole('button', { name: 'Set Secret' }).click();
    }
    await expect(page.getByRole('dialog').getByLabel(/Type the slug/)).toBeVisible();

    const slug = await page.evaluate(async (workspaceId: string) => {
      const token = localStorage.getItem('octo_token');
      const list = await (
        await fetch('/api/workspaces', { headers: { Authorization: `Bearer ${token}` } })
      ).json();
      return (list as { id: string; slug: string }[]).find((w) => w.id === workspaceId)!.slug;
    }, wsId);
    await page.getByRole('dialog').getByLabel(/Type the slug/).fill(slug);
    await page.getByRole('dialog').getByLabel('Confirmation secret').fill('e2e-confirm-secret');
    await page.getByRole('dialog').getByRole('button', { name: 'Delete Workspace' }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15000 });
  });

  test('MR-1 idempotent create: a duplicate create leaves exactly one workspace', async ({ page }) => {
    await page.goto('/');
    await page.click('text=Continue as Guest');
    await expect(page.locator('text=Workspace Control Dashboard')).toBeVisible();

    const result = await page.evaluate(async () => {
      const token = localStorage.getItem('octo_token');
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
      const name = `Idempotent ${Date.now()}`;
      const first = await (
        await fetch('/api/workspaces', { method: 'POST', headers, body: JSON.stringify({ name }) })
      ).json();
      const second = await fetch('/api/workspaces', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name }),
      });
      const list = (await (
        await fetch('/api/workspaces', { headers })
      ).json()) as { id: string; name: string }[];
      return {
        secondStatus: second.status,
        matches: list.filter((w) => w.id === first.workspace.id).length,
        totalWithName: list.filter((w) => w.name === name).length,
      };
    });

    expect(result.secondStatus).toBe(409);
    expect(result.matches).toBe(1);
    expect(result.totalWithName).toBe(1);
  });

  test('MR-3 & MR-7: a workspace key is pinned and can never delete a workspace', async ({ page }) => {
    await page.goto('/');
    await page.click('text=Continue as Guest');
    await expect(page.locator('text=Workspace Control Dashboard')).toBeVisible();

    const result = await page.evaluate(async () => {
      const token = localStorage.getItem('octo_token');
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

      // Two workspaces: the key is minted for the first only.
      const a = await (
        await fetch('/api/workspaces', {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: `Pinned A ${Date.now()}` }),
        })
      ).json();
      const b = await (
        await fetch('/api/workspaces', {
          method: 'POST',
          headers,
          body: JSON.stringify({ name: `Pinned B ${Date.now()}` }),
        })
      ).json();

      const minted = await (
        await fetch('/api/keys', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            name: 'pinned key',
            workspaceId: a.workspace.id,
            scopes: ['read', 'write', 'files', 'delete'],
          }),
        })
      ).json();
      const keyHeaders = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${minted.rawSecret}`,
      };

      // Pinning: the key reads its own workspace, never the other.
      const ownStatus = (
        await fetch(`/api/files?workspaceId=${a.workspace.id}`, { headers: keyHeaders })
      ).status;
      const otherStatus = (
        await fetch(`/api/files?workspaceId=${b.workspace.id}`, { headers: keyHeaders })
      ).status;

      // Confirmation gate: even with the delete scope, a key caller is refused.
      const deleteRes = await fetch(`/api/workspaces/${a.workspace.id}`, {
        method: 'DELETE',
        headers: keyHeaders,
        body: JSON.stringify({ confirmSecret: 'anything', confirmSlug: a.workspace.slug }),
      });

      // A malformed (empty) body must produce the same clean refusal, never a
      // 500 from parsing an absent payload.
      const deleteNoBodyRes = await fetch(`/api/workspaces/${a.workspace.id}`, {
        method: 'DELETE',
        headers: keyHeaders,
      });

      return {
        ownStatus,
        otherStatus,
        deleteStatus: deleteRes.status,
        deleteBody: await deleteRes.json(),
        deleteNoBodyStatus: deleteNoBodyRes.status,
      };
    });

    expect(result.ownStatus).toBe(200);
    expect(result.otherStatus).toBe(403);
    expect(result.deleteStatus).toBe(403);
    expect(JSON.stringify(result.deleteBody)).toMatch(/human session|API keys can never/i);
    expect(result.deleteNoBodyStatus).toBe(403);
  });
});
