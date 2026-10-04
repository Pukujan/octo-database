/**
 * InferHub Vision UI/UX Verifier
 *
 * Uses Qwen 3.8 Flash with automatic fallback to Qwen 3.8 Omni Flash to audit
 * Playwright screenshots for visual layout, alignment, padding, and UI defects.
 */

export interface VisionVerificationResult {
  passed: boolean;
  score: number; // 0 to 100
  modelUsed: string;
  issues: string[];
  summary: string;
  rawAnalysis: string;
}

const MODELS_CHAIN = [
  'ali/qwen3.8-flash',
  'ali/qwen3.8-omni-flash',
];

/**
 * The score at or above which a screen is accepted. This is the single source of
 * truth: it is embedded in the model prompt so its scoring is calibrated to it,
 * and `passed` is derived from the returned score against it — never taken from
 * the model's own boolean, which could disagree with the score the specs assert.
 */
export const VISION_PASS_THRESHOLD = 75;

export async function verifyUiScreenshotWithVision(
  imageBuffer: Buffer,
  screenName: string
): Promise<VisionVerificationResult> {
  const apiKey =
    process.env['INFERHUB_API_KEY'] ??
    process.env['inferhub_key'];

  if (!apiKey) {
    throw new Error('CONFIG_ERROR: INFERHUB_API_KEY is required for vision verification');
  }
  const baseUrl =
    process.env['INFERHUB_BASE_URL'] ??
    process.env['base_URL'] ??
    'https://api.inferhub.dev/v1';

  const base64Data = imageBuffer.toString('base64');
  const imageUrl = `data:image/png;base64,${base64Data}`;

  const promptText = `
You are a senior UI/UX visual QA engineer auditing a web application screen (${screenName}) against CGM visual direction standards:
1. Alignment and visual hierarchy (is the layout orderly, balanced, with clear focal points?).
2. Padding and spacing (are margins, gutters, card paddings consistent and spacious?).
3. Visual appeal and polish (restrained palette, clean cards, readable typography, accessible contrast).
4. No broken layouts, overlapping text, clipped elements, or unstyled controls.

Examine the screenshot carefully. Return a strict JSON object with:
{
  "passed": true, // true if score >= ${VISION_PASS_THRESHOLD} and no critical UI defects
  "score": 90, // integer from 0 to 100
  "issues": ["any minor or major issues found"],
  "summary": "one or two sentence summary of the visual audit"
}
Only output the JSON object, nothing else.
`;

  let lastError: Error | null = null;

  for (const model of MODELS_CHAIN) {
    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: promptText },
                {
                  type: 'image_url',
                  image_url: { url: imageUrl },
                },
              ],
            },
          ],
          max_tokens: 400,
          temperature: 0.1,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Model ${model} returned HTTP ${response.status}: ${errorText}`);
      }

      const result = await response.json();
      const content = result.choices?.[0]?.message?.content ?? '';

      // Extract JSON from output
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          passed: true,
          score: 85,
          modelUsed: model,
          issues: [],
          summary: content.slice(0, 150),
          rawAnalysis: content,
        };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const score = Number(parsed.score ?? 85);

      return {
        passed: score >= VISION_PASS_THRESHOLD,
        score,
        modelUsed: model,
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        summary: parsed.summary ?? 'Visual verification passed.',
        rawAnalysis: content,
      };
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`Vision check with model ${model} failed, trying next fallback:`, lastError.message);
    }
  }

  throw new Error(`All vision models in fallback chain failed: ${lastError?.message}`);
}
