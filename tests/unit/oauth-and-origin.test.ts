/**
 * Unit Tests: Public Origin Resolution and OAuth Endpoints (OCTO-1000)
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IncomingMessage } from 'http';
import { AddressInfo, Socket } from 'net';
import { getGoogleClientCredentials, getPublicOrigin, server } from '../../src/server/index';

function makeMockRequest(headers: Record<string, string | string[] | undefined> = {}): IncomingMessage {
  const req = new IncomingMessage(new Socket());
  req.headers = headers;
  return req;
}

describe('getPublicOrigin', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env['PUBLIC_BASE_URL'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('prefers PUBLIC_BASE_URL and trims trailing slashes', () => {
    process.env['PUBLIC_BASE_URL'] = 'https://octodb.design-bakery.com///';
    const req = makeMockRequest({
      'x-forwarded-proto': 'http',
      'x-forwarded-host': 'localhost:3001',
    });
    const url = new URL('http://localhost:3001/api/auth/google');
    expect(getPublicOrigin(req, url)).toBe('https://octodb.design-bakery.com');
  });

  it('derives origin from X-Forwarded-Proto and X-Forwarded-Host', () => {
    const req = makeMockRequest({
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'octodb.design-bakery.com',
    });
    const url = new URL('http://localhost:3001/api/auth/google');
    expect(getPublicOrigin(req, url)).toBe('https://octodb.design-bakery.com');
  });

  it('handles comma-separated proxy lists in forwarded headers', () => {
    const req = makeMockRequest({
      'x-forwarded-proto': 'https, http',
      'x-forwarded-host': 'octodb.design-bakery.com, proxy.internal',
    });
    const url = new URL('http://localhost:3001/api/auth/google');
    expect(getPublicOrigin(req, url)).toBe('https://octodb.design-bakery.com');
  });

  it('falls back to Host header when forwarded headers are absent', () => {
    const req = makeMockRequest({
      host: 'preview.octo.local:8090',
    });
    const url = new URL('http://localhost:3001/api/auth/google');
    expect(getPublicOrigin(req, url)).toBe('http://preview.octo.local:8090');
  });

  it('falls back to URL origin when no headers are provided', () => {
    const req = makeMockRequest({});
    const url = new URL('http://127.0.0.1:3001/api/auth/google');
    expect(getPublicOrigin(req, url)).toBe('http://127.0.0.1:3001');
  });
});

describe('getGoogleClientCredentials', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env['GOOGLE_OAUTH_CLIENT_ID'];
    delete process.env['GOOGLE_OAUTH_CLIENT_SECRET'];
    delete process.env['GOOGLE_CLIENT_ID'];
    delete process.env['GOOGLE_CLIENT_SECRET'];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns nulls when no variables are set', () => {
    const creds = getGoogleClientCredentials();
    expect(creds.clientId).toBeNull();
    expect(creds.clientSecret).toBeNull();
  });

  it('prefers GOOGLE_OAUTH_CLIENT_* names when present', () => {
    process.env['GOOGLE_OAUTH_CLIENT_ID'] = 'oauth-client-id';
    process.env['GOOGLE_OAUTH_CLIENT_SECRET'] = 'oauth-client-secret';
    process.env['GOOGLE_CLIENT_ID'] = 'legacy-client-id';
    process.env['GOOGLE_CLIENT_SECRET'] = 'legacy-client-secret';

    const creds = getGoogleClientCredentials();
    expect(creds.clientId).toBe('oauth-client-id');
    expect(creds.clientSecret).toBe('oauth-client-secret');
  });

  it('falls back to GOOGLE_CLIENT_* names from existing repo config', () => {
    process.env['GOOGLE_CLIENT_ID'] = 'existing-client-id';
    process.env['GOOGLE_CLIENT_SECRET'] = 'existing-client-secret';

    const creds = getGoogleClientCredentials();
    expect(creds.clientId).toBe('existing-client-id');
    expect(creds.clientSecret).toBe('existing-client-secret');
  });
});

describe('Server OAuth & Me HTTP Routes', () => {
  const originalEnv = { ...process.env };
  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('GET /api/me returns 401 when unauthenticated', async () => {
    const res = await fetch(`${baseUrl}/api/me`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('UNAUTHENTICATED');
  });

  it('GET /api/auth/google returns 501 when no Google credentials are configured', async () => {
    delete process.env['GOOGLE_OAUTH_CLIENT_ID'];
    delete process.env['GOOGLE_CLIENT_ID'];

    const res = await fetch(`${baseUrl}/api/auth/google`, { redirect: 'manual' });
    expect(res.status).toBe(501);
  });

  it('GET /api/auth/google redirects to Google with public origin redirect_uri', async () => {
    process.env['GOOGLE_CLIENT_ID'] = 'mock-client-id';
    process.env['PUBLIC_BASE_URL'] = 'https://octodb.design-bakery.com';

    const res = await fetch(`${baseUrl}/api/auth/google`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toContain('accounts.google.com');
    expect(location).toContain('client_id=mock-client-id');
    expect(location).toContain('redirect_uri=https%3A%2F%2Foctodb.design-bakery.com%2Fapi%2Fauth%2Fgoogle%2Fcallback');
  });

  it('GET /api/auth/google/callback redirects with #auth_error when code is missing', async () => {
    process.env['PUBLIC_BASE_URL'] = 'https://octodb.design-bakery.com';

    const res = await fetch(`${baseUrl}/api/auth/google/callback`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toBe('https://octodb.design-bakery.com/#auth_error=MISSING_CODE');
  });

  it('GET /api/auth/google/callback redirects with #auth_error when error param is returned', async () => {
    process.env['PUBLIC_BASE_URL'] = 'https://octodb.design-bakery.com';

    const res = await fetch(`${baseUrl}/api/auth/google/callback?error=access_denied`, { redirect: 'manual' });
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    expect(location).toBe('https://octodb.design-bakery.com/#auth_error=access_denied');
  });
});

