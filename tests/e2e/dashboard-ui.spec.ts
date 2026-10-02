/**
 * Playwright E2E & Vision Model UI/UX Verification
 *
 * Verifies live browser interaction, layout integrity, and runs multimodal vision
 * verification (Qwen 3.8 Flash fallback chain via InferHub) on rendered screenshots.
 */

import { expect, test } from '@playwright/test';
import { auditPage } from './vision-audit';

test.describe('Octo Full-Stack Dashboard E2E & Vision QA', () => {
  test('renders login screen, audits visual quality with vision model, and enters guest mode', async ({
    page,
  }) => {
    test.setTimeout(180000);
    // 1. Navigate to application
    await page.goto('/');
    await expect(page.locator('text=Welcome to Octo')).toBeVisible();

    // Google sign-in is only offered when an OAuth client is provisioned; otherwise
    // the control must report that state instead of linking to a dead route.
    const googleConfigured = Boolean(process.env['GOOGLE_OAUTH_CLIENT_ID']);
    if (googleConfigured) {
      await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeEnabled();
    } else {
      await expect(page.getByRole('button', { name: 'Google sign-in not configured' })).toBeDisabled();
    }
    await expect(page.locator('text=Continue as Guest')).toBeVisible();

    // 2 & 3. Multimodal Vision Audit (Qwen 3.8 Flash on InferHub).
    // Skipped only where the credential cannot exist (fork PRs); every same-repo
    // run performs the real audit.
    const loginVisionResult = await auditPage(page, 'Login Screen');
    if (loginVisionResult) {
      expect(loginVisionResult.passed).toBe(true);
      expect(loginVisionResult.score).toBeGreaterThanOrEqual(75);
    }

    // 4. Click "Continue as Guest"
    await page.click('text=Continue as Guest');

    // 5. Verify Workspace Control Dashboard renders
    await expect(page.locator('text=Workspace Control Dashboard')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Personal (Guest)', exact: true })).toBeVisible();
    await expect(page.locator('text=Guest Sandbox')).toBeVisible();
    await expect(page.locator('text=File Catalog (Cloudflare R2)')).toBeVisible();
    await expect(page.locator('text=API Keys (Account-Wide & Workspace-Scoped)')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Gallery$/ })).toBeVisible();

    // 6 & 7. Multimodal Vision Audit on the authenticated dashboard.
    const dashVisionResult = await auditPage(page, 'Dashboard');
    if (dashVisionResult) {
      expect(dashVisionResult.passed).toBe(true);
      expect(dashVisionResult.score).toBeGreaterThanOrEqual(75);
    }

    // 8. Test File Upload via UI
    await page.fill('input[placeholder="notes.txt"]', 'qa_report.txt');
    await page.fill('input[placeholder="File body content..."]', 'Live visual QA report verification text.');
    await page.click('button:has-text("Upload Text to R2")');

    // Verify file appears in table
    await expect(page.getByRole('cell', { name: 'qa_report.txt', exact: true })).toBeVisible();

    // 9. Test API Key Generation via UI
    await page.fill('input[placeholder="e.g. Ingest Agent"]', 'Vision E2E Agent');
    await page.click('button:has-text("Generate API Key")');

    // Verify minted key alert appears with the one-time secret. The exact
    // pattern avoids matching the `octo_live_ws_...` placeholder in the usage
    // panel's curl example.
    await expect(page.locator('text=New API Key Minted')).toBeVisible();
    await expect(page.getByText(/^octo_live_ws_[0-9a-f]{32}$/)).toBeVisible();

    // 10. Sign out cleanly
    await page.click('button:has-text("Sign out")');
    await expect(page.locator('text=Welcome to Octo')).toBeVisible();
  });

  test('discards a dead persisted session instead of showing an empty workspace shell', async ({
    page,
  }) => {
    // Reproduces the reported state: a token in localStorage that the server no
    // longer honours, alongside a persisted principal. Before revalidation the
    // app kept the stale principal and rendered the authenticated shell with
    // "No Authorized Workspaces"; the server is the authority, so an expired
    // token must return the caller to the login screen.
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.setItem('octo_token', '00000000-0000-0000-0000-000000000000');
      localStorage.setItem(
        'octo_principal',
        JSON.stringify({
          id: '00000000-0000-0000-0000-000000000000',
          authUserId: '00000000-0000-0000-0000-000000000000',
          email: 'stale@example.com',
          displayName: 'Stale User',
          avatarUrl: null,
          isPlatformOwner: false,
          isGuest: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );
    });
    await page.reload();

    await expect(page.locator('text=Welcome to Octo')).toBeVisible();
    await expect(page.locator('text=No Authorized Workspaces')).toHaveCount(0);

    // The dead credential is cleared, not left behind to fail every later call.
    const token = await page.evaluate(() => localStorage.getItem('octo_token'));
    expect(token).toBeNull();
  });
});
