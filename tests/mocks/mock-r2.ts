/**
 * Mock Cloudflare R2 Storage Provider
 *
 * In-memory S3-compatible object storage double for integration testing.
 */

import {
  GetObjectResult,
  ObjectSummary,
  PutObjectResult,
  R2StorageProvider,
} from '../../src/storage/r2-client';

export class MockR2StorageProvider implements Partial<R2StorageProvider> {
  public bucket = 'mock-r2-bucket';
  private objects = new Map<string, { data: Uint8Array; contentType: string; etag: string }>();

  async putObject(
    key: string,
    body: Uint8Array | Buffer | string,
    contentType = 'application/octet-stream'
  ): Promise<PutObjectResult> {
    const data = typeof body === 'string' ? Buffer.from(body, 'utf-8') : body;
    const etag = `etag-${Date.now()}`;
    this.objects.set(key, { data, contentType, etag });

    return {
      key,
      sizeBytes: data.byteLength,
      etag,
    };
  }

  async getObject(key: string): Promise<GetObjectResult> {
    const obj = this.objects.get(key);
    if (!obj) {
      throw new Error(`NoSuchKey: The specified key does not exist: ${key}`);
    }

    return {
      key,
      data: obj.data,
      contentType: obj.contentType,
      contentLength: obj.data.byteLength,
    };
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async headObject(
    key: string
  ): Promise<{ contentLength?: number; contentType?: string; etag?: string } | null> {
    const obj = this.objects.get(key);
    if (!obj) return null;

    return {
      contentLength: obj.data.byteLength,
      contentType: obj.contentType,
      etag: obj.etag,
    };
  }

  async generatePresignedDownloadUrl(key: string, _expiresInSeconds = 3600): Promise<string> {
    return `https://r2.mock.cloudflarestorage.com/${this.bucket}/${key}?token=mock-presigned-download`;
  }

  async generatePresignedUploadUrl(
    key: string,
    _contentType: string,
    _expiresInSeconds = 3600
  ): Promise<string> {
    return `https://r2.mock.cloudflarestorage.com/${this.bucket}/${key}?token=mock-presigned-upload`;
  }

  async listObjects(prefix = ''): Promise<ObjectSummary[]> {
    const results: ObjectSummary[] = [];
    this.objects.forEach((val, key) => {
      if (key.startsWith(prefix)) {
        results.push({
          key,
          size: val.data.byteLength,
          etag: val.etag,
        });
      }
    });
    return results;
  }

  clear(): void {
    this.objects.clear();
  }
}
