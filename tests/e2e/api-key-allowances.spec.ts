import { expect, test } from '@playwright/test';
import { typeConfirmCode } from './confirm-secret';

test('edits one key allowance without minting a new secret', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Continue as Guest' }).click();
  await page.getByRole('button', { name: 'Access', exact: true }).click();
  await page.fill('input[placeholder="e.g. Ingest Agent"]', 'Allowance Agent');
  await typeConfirmCode(page);
  await page.getByRole('button', { name: 'Generate API Key' }).click();
  await expect(page.locator('section.one-time-notice').getByText('New API Key Minted')).toBeVisible();

  const editor = page.locator('form[data-form="key-allowances"]');
  // The allowance editor is collapsed behind a dropdown; open it before editing.
  await editor.locator('summary.dropdown-summary').click();
  const deletion = editor.locator('input[value="delete"]');
  await expect(deletion).not.toBeChecked();
  await deletion.check();
  await typeConfirmCode(page);
  await editor.getByRole('button', { name: 'Save' }).click();

  await expect(page.getByText('Allowances saved')).toBeVisible();
  await page.locator('form[data-form="key-allowances"] summary.dropdown-summary').click();
  await expect(page.locator('form[data-form="key-allowances"] input[value="delete"]')).toBeChecked();
  await expect(page.locator('form[data-form="key-allowances"] input[value="read"]')).toBeChecked();
  await expect(page.locator('section.one-time-notice')).toHaveCount(1);
});
