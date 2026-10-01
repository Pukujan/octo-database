/**
 * Playwright E2E & Vision Model UI/UX Verification
 *
 * Verifies live browser interaction, layout integrity, and runs multimodal vision
 * verification (Qwen 3.8 Flash fallback chain via InferHub) on rendered screenshots.
 */

import { expect, test } from '@playwright/test';
import { verifyUiScreenshotWithVision } from '../../src/qa/vision-verifier';

test.describe('Octo Full-Stack Dashboard E2E & Vision QA', () => {
  test('renders login screen, audits visual quality with vision model, and enters guest mode', async ({
    page,
  }) => {
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

    // 2. Capture screenshot of unauthenticated login hero
    const loginScreenshot = await page.screenshot({ fullPage: true });

    // 3. Multimodal Vision Audit (Qwen 3.8 Flash on InferHub)
    console.log('Auditing Login Screen screenshot with Qwen 3.8 Flash...');
    const loginVisionResult = await verifyUiScreenshotWithVision(loginScreenshot, 'Login Screen');
    console.log(`- Model: ${loginVisionResult.modelUsed}`);
    console.log(`- Score: ${loginVisionResult.score}/100`);
    console.log(`- Summary: ${loginVisionResult.summary}`);
    if (loginVisionResult.issues.length > 0) {
      console.log(`- Notes: ${loginVisionResult.issues.join(', ')}`);
    }
    expect(loginVisionResult.passed).toBe(true);
    expect(loginVisionResult.score).toBeGreaterThanOrEqual(75);

    // 4. Click "Continue as Guest"
    await page.click('text=Continue as Guest');

    // 5. Verify Workspace Control Dashboard renders
    await expect(page.locator('text=Workspace Control Dashboard')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Personal (Guest)', exact: true })).toBeVisible();
    await expect(page.locator('text=Guest Sandbox')).toBeVisible();
    await expect(page.locator('text=File Catalog (Cloudflare R2)')).toBeVisible();
    await expect(page.locator('text=API Keys (Account-Wide & Workspace-Scoped)')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Gallery$/ })).toBeVisible();

    // 6. Capture screenshot of authenticated workspace dashboard
    const dashboardScreenshot = await page.screenshot({ fullPage: true });

    // 7. Multimodal Vision Audit on Dashboard (Qwen 3.8 Flash on InferHub)
    console.log('Auditing Authenticated Dashboard screenshot with Qwen 3.8 Flash...');
    const dashVisionResult = await verifyUiScreenshotWithVision(dashboardScreenshot, 'Dashboard');
    console.log(`- Model: ${dashVisionResult.modelUsed}`);
    console.log(`- Score: ${dashVisionResult.score}/100`);
    console.log(`- Summary: ${dashVisionResult.summary}`);
    if (dashVisionResult.issues.length > 0) {
      console.log(`- Notes: ${dashVisionResult.issues.join(', ')}`);
    }
    expect(dashVisionResult.passed).toBe(true);
    expect(dashVisionResult.score).toBeGreaterThanOrEqual(75);

    // 8. Test File Upload via UI
    await page.fill('input[placeholder="notes.txt"]', 'qa_report.txt');
    await page.fill('input[placeholder="File body content..."]', 'Live visual QA report verification text.');
    await page.click('button:has-text("Upload Text to R2")');

    // Verify file appears in table
    await expect(page.getByRole('cell', { name: 'qa_report.txt', exact: true })).toBeVisible();

    // 9. Test API Key Generation via UI
    await page.fill('input[placeholder="e.g. Ingest Agent"]', 'Vision E2E Agent');
    await page.click('button:has-text("Generate API Key")');

    // Verify minted key alert appears with secret
    await expect(page.locator('text=New API Key Minted')).toBeVisible();
    await expect(page.locator('text=octo_live_ws_')).toBeVisible();

    // 10. Sign out cleanly
    await page.click('button:has-text("Sign out")');
    await expect(page.locator('text=Welcome to Octo')).toBeVisible();
  });
});
