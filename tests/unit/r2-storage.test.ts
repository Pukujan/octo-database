/**
 * Unit Tests: Cloudflare R2 Active Storage Engine (Slice 2)
 */

import { describe, expect, it } from 'vitest';
import { loadR2ConfigFromEnv, R2StorageConfig, R2StorageProvider } from '../../src/storage/r2-client';

describe('R2 Configuration Loader', () => {
  it('loads valid configuration when environment variables are set', () => {
    process.env['S3_API_ENDPOINT'] = 'https://mock-account.r2.cloudflarestorage.com';
    process.env['ACCESS_KEY_ID'] = 'mock-access-key';
    process.env['CLOUDFLARE_SECRET_ACCESS_KEY'] = 'mock-secret-key';
    process.env['OCTO_R2_BUCKET'] = 'test-bucket';

    const config = loadR2ConfigFromEnv();
    expect(config.endpoint).toBe('https://mock-account.r2.cloudflarestorage.com');
    expect(config.accessKeyId).toBe('mock-access-key');
    expect(config.secretAccessKey).toBe('mock-secret-key');
    expect(config.bucket).toBe('test-bucket');
  });

  it('fails closed when required credentials are missing', () => {
    delete process.env['S3_API_ENDPOINT'];
    delete process.env['ACCESS_KEY_ID'];
    delete process.env['CLOUDFLARE_SECRET_ACCESS_KEY'];

    expect(() => loadR2ConfigFromEnv()).toThrow(/MISSING_R2_CREDENTIALS/);
  });
});

describe('R2 Storage Provider Instance', () => {
  it('initializes with custom bucket and auto region', () => {
    const config: R2StorageConfig = {
      endpoint: 'https://test.r2.cloudflarestorage.com',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      bucket: 'my-octo-bucket',
    };

    const provider = new R2StorageProvider(config);
    expect(provider.bucket).toBe('my-octo-bucket');
  });
});
