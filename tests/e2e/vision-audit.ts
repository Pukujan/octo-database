/**
 * Shared vision-audit helper for Playwright specs.
 *
 * Fork pull requests never receive repository secrets, so the InferHub key is
 * absent there by design. Rather than failing those PRs on an unsatisfiable
 * dependency, the audit is skipped and the skip is reported loudly. Same-repo
 * runs (including every push to main) always perform the real audit.
 */

import type { Page } from '@playwright/test';
import { verifyUiScreenshotWithVision, VisionVerificationResult } from '../../src/qa/vision-verifier';

export function visionAuditAvailable(): boolean {
  return Boolean(process.env['INFERHUB_API_KEY'] ?? process.env['inferhub_key']);
}

/**
 * Audits the current page with the vision model, or returns null when the
 * credential is unavailable (fork PR) so the caller can skip assertions.
 */
export async function auditPage(
  page: Page,
  screenName: string
): Promise<VisionVerificationResult | null> {
  if (!visionAuditAvailable()) {
    console.log(
      `[vision-audit] SKIPPED for "${screenName}": INFERHUB_API_KEY is not available in this context ` +
        '(fork pull requests do not receive repository secrets).'
    );
    return null;
  }

  const screenshot = await page.screenshot({ fullPage: true });
  const result = await verifyUiScreenshotWithVision(screenshot, screenName);

  console.log(`[vision-audit] ${screenName} — model=${result.modelUsed} score=${result.score} passed=${result.passed}`);
  console.log(`[vision-audit] ${result.summary}`);
  for (const issue of result.issues) {
    console.log(`[vision-audit] note: ${issue}`);
  }

  return result;
}
