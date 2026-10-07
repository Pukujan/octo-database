import { expect, test, type Locator } from '@playwright/test';
import { typeConfirmCode } from './confirm-secret';

test('keeps API key creation and the new secret on a phone screen', async ({ page }) => {
  const viewport = { width: 390, height: 700 };
  await page.setViewportSize(viewport);
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as Guest' }).click();
  await page.getByRole('button', { name: 'Access', exact: true }).click();

  const code = page.locator('.confirm-code');
  const button = page.getByRole('button', { name: 'Generate API Key' });
  await expect(code).toBeVisible();
  await expect(button).toBeVisible();
  await expectOnScreen(code, viewport);
  await expectOnScreen(button, viewport);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  await page.fill('input[placeholder="e.g. Ingest Agent"]', 'Phone Agent');
  await typeConfirmCode(page);
  await button.click();

  const notice = page.locator('section.one-time-notice');
  await expect(notice.getByText('New API Key Minted')).toBeVisible();
  await expectOnScreen(notice, viewport);
  await expectOnScreen(notice.getByRole('button', { name: 'Copy' }), viewport);
  await expectOnScreen(notice.getByRole('button', { name: 'Done' }), viewport);
});

async function expectOnScreen(
  locator: Locator,
  viewport: { width: number; height: number },
): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1);
}
