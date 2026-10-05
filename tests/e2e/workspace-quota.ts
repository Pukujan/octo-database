/**
 * Shared E2E helper for the Slice 16 workspace-creation daily limit.
 *
 * A non-owner principal may create at most one workspace per rolling day. Tests
 * that exercise a different workspace behavior but need two API-created
 * workspaces in one run (pinning, idempotent create) would otherwise be refused
 * by the limit. The platform owner is exempt, so a fixture marks its principal
 * an owner to sidestep the quota without weakening the behavior under test.
 */

import { Page } from '@playwright/test';
import { queryService } from '../../src/server/db';

export async function exemptFromDailyLimit(page: Page): Promise<void> {
  const principalId = await page.evaluate(async () => {
    const token = localStorage.getItem('octo_token');
    const me = await (
      await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } })
    ).json();
    return (me as { principal: { id: string } }).principal.id;
  });
  await queryService('UPDATE octo.principals SET is_platform_owner = true WHERE id = $1', [
    principalId,
  ]);
}
