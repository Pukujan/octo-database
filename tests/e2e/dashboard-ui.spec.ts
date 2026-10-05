/**
 * Playwright E2E & Vision Model UI/UX Verification
 *
 * Verifies live browser interaction, layout integrity, and runs multimodal vision
 * verification (Qwen 3.8 Flash fallback chain via InferHub) on rendered screenshots.
 */

import { expect, test, Page } from '@playwright/test';
import { auditPage } from './vision-audit';

/**
 * Arms the confirmation gate from the Access view's inline mint form. Minting is
 * stamped, so the secret must be set (first run) and supplied every time; setting
 * it re-renders and clears the form, so call this before filling the key name.
 */
async function armConfirmSecret(page: Page): Promise<void> {
  const secretField = page.locator('input[name="secret"]');
  await secretField.waitFor({ state: 'visible' });
  const newSecret = page.locator('input[name="newSecret"]');
  if ((await newSecret.count()) > 0) {
    await newSecret.fill('e2e-confirm-secret');
    await page.click('button[data-action="set-secret"]');
    // Setting the secret re-renders the form; wait for it to settle before typing.
    await newSecret.waitFor({ state: 'detached' });
  }
  await secretField.fill('e2e-confirm-secret');
}

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
    await expect(page.locator('text=File Catalog')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Gallery$/ })).toBeVisible();

    // 6 & 7. Multimodal Vision Audit on the authenticated dashboard.
    const dashVisionResult = await auditPage(page, 'Dashboard');
    if (dashVisionResult) {
      expect(dashVisionResult.passed).toBe(true);
      expect(dashVisionResult.score).toBeGreaterThanOrEqual(75);
    }

    // 8. Test File Upload via the focused Files view.
    await page.getByRole('button', { name: 'Files', exact: true }).click();
    await page.getByRole('button', { name: 'New text file' }).click();
    await page.fill('input[placeholder="notes.txt"]', 'qa_report.txt');
    await page.fill('textarea[placeholder="Write something useful…"]', 'Live visual QA report verification text.');
    await page.getByRole('button', { name: 'Save file' }).click();

    // Verify file appears in table
    await expect(page.getByRole('cell', { name: 'qa_report.txt', exact: true })).toBeVisible();

    // 9. Test API Key Generation via Access.
    await page.getByRole('button', { name: 'Access', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'API keys' })).toBeVisible();
    await armConfirmSecret(page);
    await page.fill('input[placeholder="e.g. Ingest Agent"]', 'Vision E2E Agent');
    await page.click('button:has-text("Generate API Key")');

    // Verify minted key alert appears with the one-time secret. The exact
    // pattern avoids matching the `octo_live_ws_...` placeholder in the usage
    // panel's curl example.
    await expect(page.locator('text=New API Key Minted')).toBeVisible();
    await expect(page.getByText(/^octo_live_ws_[0-9a-f]{32}$/)).toBeVisible();

    // 10. Sign out cleanly
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.locator('text=Welcome to Octo')).toBeVisible();
  });

  test('applies the saved color theme on the login screen, not only inside the app', async ({
    page,
  }) => {
    // The theme attribute drives which palette the whole document uses. It was
    // set only when the authenticated shell rendered, so a returning user who
    // chose the light theme still saw a dark login screen on a fresh load.
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('octo-design-system', 'paper'));
    await page.reload();

    await expect(page.locator('text=Welcome to Octo')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-octo-system', 'paper');
  });

  test('surfaces a workspace load failure instead of a misleading empty workspace', async ({
    page,
  }) => {
    // A single failing workspace request (here the file listing) must not be
    // silently coerced to an empty list: an empty workspace and a failed one look
    // identical to the user, and only the latter needs attention.
    await page.goto('/');
    await page.route(/\/api\/files\?/, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'INTERNAL_SERVER_ERROR' }),
      })
    );
    await page.click('text=Continue as Guest');
    await expect(page.locator('text=Workspace Control Dashboard')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText(/could not load/i);
  });

  test('a disabled Google button keeps its label legible instead of fading it out', async ({
    page,
  }) => {
    // The disabled "Google sign-in not configured" control is the only signal
    // that Google auth is off, so its label must stay readable. A blanket
    // opacity dims the text toward the panel until it can no longer be read;
    // measure the rendered contrast and require comfortably legible text.
    await page.goto('/');
    test.skip(
      (await page.getByRole('button', { name: 'Sign in with Google' }).count()) > 0,
      'Google sign-in is configured in this environment'
    );
    const button = page.getByRole('button', { name: 'Google sign-in not configured' });
    await expect(button).toBeDisabled();

    const ratio = await button.evaluate((el) => {
      const channels = (color: string) => (color.match(/[\d.]+/g) ?? []).map(Number);
      const linear = (value: number) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      };
      const luminance = (rgb: number[]) =>
        0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
      const style = getComputedStyle(el);
      const opacity = Number(style.opacity);
      const page = channels(getComputedStyle(document.body).backgroundColor);
      // Opacity composites the whole control (label over its own surface) toward
      // whatever sits behind it, so model that before comparing the two.
      const seen = (color: string) =>
        channels(color).map((value, i) => value * opacity + page[i] * (1 - opacity));
      const [bright, dim] = [luminance(seen(style.color)), luminance(seen(style.backgroundColor))].sort(
        (a, b) => b - a
      );
      return (bright + 0.05) / (dim + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(7);
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

  test('a one-time secret does not survive sign-out into the next session', async ({ page }) => {
    // The minted secret lives in client state, not localStorage. If sign-out
    // clears only the token and principal, the secret stays in memory and the
    // Access view renders it for the next person who signs in on this machine —
    // a one-time key disclosed to a different session. Sign-out must clear it.
    await page.goto('/');
    await page.click('text=Continue as Guest');
    await page.getByRole('button', { name: 'Access', exact: true }).click();
    await armConfirmSecret(page);
    await page.fill('input[placeholder="e.g. Ingest Agent"]', 'Leak Probe Agent');
    await page.click('button:has-text("Generate API Key")');

    const secret = page.getByText(/^octo_live_ws_[0-9a-f]{32}$/);
    await expect(secret).toBeVisible();
    const value = ((await secret.textContent()) ?? '').trim();
    expect(value).toMatch(/^octo_live_ws_[0-9a-f]{32}$/);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.locator('text=Welcome to Octo')).toBeVisible();

    // A fresh guest session must not be shown the previous session's key.
    await page.click('text=Continue as Guest');
    await page.getByRole('button', { name: 'Access', exact: true }).click();
    await expect(page.getByText(value, { exact: true })).toHaveCount(0);
    await expect(page.locator('text=New API Key Minted')).toHaveCount(0);
  });
});
