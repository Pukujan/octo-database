import { runProductionSmoke } from '../src/qa/production-smoke';

const baseUrl = process.env['OCTO_SMOKE_BASE_URL'] ?? 'https://octodb.design-bakery.com';

try {
  const result = await runProductionSmoke(baseUrl);
  console.log(JSON.stringify({ baseUrl, ...result }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
