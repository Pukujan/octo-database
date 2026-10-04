export interface ProductionSmokeResult {
  health: boolean;
  frontend: boolean;
  asset: boolean;
  unauthenticatedApi: boolean;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

function originOf(baseUrl: string): string {
  return new URL(baseUrl).toString().replace(/\/$/, '');
}

async function requireResponse(fetchImpl: FetchLike, url: string, expectedStatus: number): Promise<Response> {
  const response = await fetchImpl(url, { method: 'GET' });
  if (response.status !== expectedStatus) {
    throw new Error(`SMOKE_FAILED: ${url} returned ${response.status}, expected ${expectedStatus}`);
  }
  return response;
}

export async function runProductionSmoke(
  baseUrl: string,
  fetchImpl: FetchLike = fetch
): Promise<ProductionSmokeResult> {
  const origin = originOf(baseUrl);

  const healthResponse = await requireResponse(fetchImpl, `${origin}/health`, 200);
  const health = await healthResponse.json() as {
    status?: unknown;
    database?: { connected?: unknown };
    r2?: { connected?: unknown };
  };
  if (health.status !== 'ok' || health.database?.connected !== true) {
    throw new Error('SMOKE_FAILED: /health did not report status ok with a connected database');
  }
  if (health.r2?.connected !== true) {
    throw new Error('SMOKE_FAILED: /health did not report a connected r2 active store');
  }

  const frontendResponse = await requireResponse(fetchImpl, `${origin}/`, 200);
  const html = await frontendResponse.text();
  if (!/text\/html/i.test(frontendResponse.headers.get('content-type') ?? '') || !/<html[\s>]/i.test(html)) {
    throw new Error('SMOKE_FAILED: / did not return an HTML document');
  }

  const assetMatch = html.match(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/i);
  if (!assetMatch?.[1]) {
    throw new Error('SMOKE_FAILED: frontend HTML did not reference a JavaScript or CSS asset');
  }
  const assetUrl = new URL(assetMatch[1], `${origin}/`).toString();
  await requireResponse(fetchImpl, assetUrl, 200);

  await requireResponse(fetchImpl, `${origin}/api/workspaces`, 401);

  return { health: true, frontend: true, asset: true, unauthenticatedApi: true };
}
