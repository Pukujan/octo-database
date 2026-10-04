/**
 * Unit tests: vision verifier pass/fail contract.
 *
 * The verifier is the gate the E2E specs assert against: every caller checks
 * `passed === true` AND `score >= VISION_PASS_THRESHOLD`. If `passed` were taken
 * from the model's own judgement it could disagree with the score the tests see
 * (the model was previously told to pass only at >= 80 while the specs accept
 * >= 75), failing a run whose score the suite considers acceptable. `passed`
 * must therefore be derived from the score against the one shared threshold.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyUiScreenshotWithVision, VISION_PASS_THRESHOLD } from '../../src/qa/vision-verifier';

function stubModel(content: string): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
    })
  );
}

const originalKey = process.env['INFERHUB_API_KEY'];

beforeEach(() => {
  process.env['INFERHUB_API_KEY'] = 'test-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env['INFERHUB_API_KEY'];
  else process.env['INFERHUB_API_KEY'] = originalKey;
});

describe('vision verifier pass contract', () => {
  it('passes a score at the threshold even when the model marks it failed', async () => {
    stubModel(JSON.stringify({ passed: false, score: VISION_PASS_THRESHOLD, issues: [], summary: 'ok' }));
    const result = await verifyUiScreenshotWithVision(Buffer.from('img'), 'Screen');
    expect(result.score).toBe(VISION_PASS_THRESHOLD);
    expect(result.passed).toBe(true);
  });

  it('passes a score just above the threshold', async () => {
    stubModel(JSON.stringify({ passed: false, score: VISION_PASS_THRESHOLD + 3, issues: [], summary: 'ok' }));
    const result = await verifyUiScreenshotWithVision(Buffer.from('img'), 'Screen');
    expect(result.passed).toBe(true);
  });

  it('fails a score below the threshold', async () => {
    stubModel(JSON.stringify({ passed: true, score: VISION_PASS_THRESHOLD - 1, issues: ['contrast'], summary: 'poor' }));
    const result = await verifyUiScreenshotWithVision(Buffer.from('img'), 'Screen');
    expect(result.passed).toBe(false);
  });
});
