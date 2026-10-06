/**
 * Cloudflare R2 Active Storage Client (Slice 2)
 *
 * Implements S3-compatible object storage operations for Octo.
 */

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface R2StorageConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region?: string;
}

export interface PutObjectResult {
  key: string;
  sizeBytes: number;
  etag?: string;
}

export interface GetObjectResult {
  key: string;
  data: Uint8Array;
  contentType?: string;
  contentLength?: number;
}

export interface ObjectSummary {
  key: string;
  size: number;
  lastModified?: Date;
  etag?: string;
}

export interface PublicCopyInput {
  Bucket: string;
  Key: string;
  CopySource: string;
  ContentType: string;
  MetadataDirective: 'REPLACE';
}

/** Each path segment is encoded. Slashes between segments stay slashes. */
export function encodeCopySource(bucket: string, key: string): string {
  const encodedKey = key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${encodeURIComponent(bucket)}/${encodedKey}`;
}

/**
 * One-object copy into the public bucket. The destination key is the file id.
 * This input is not a list request and sets no ACL.
 */
export function buildPublicCopyInput(args: {
  sourceBucket: string;
  sourceKey: string;
  destBucket: string;
  destKey: string;
  contentType: string;
}): PublicCopyInput {
  return {
    Bucket: args.destBucket,
    Key: args.destKey,
    CopySource: encodeCopySource(args.sourceBucket, args.sourceKey),
    ContentType: args.contentType,
    MetadataDirective: 'REPLACE',
  };
}

/**
 * Loads R2 storage configuration from environment variables.
 * Fails closed if required credentials are not present.
 */
export function loadR2ConfigFromEnv(): R2StorageConfig {
  const endpoint = process.env['S3_API_ENDPOINT'] ?? process.env['R2_ENDPOINT'];
  const accessKeyId = process.env['ACCESS_KEY_ID'] ?? process.env['R2_ACCESS_KEY_ID'];
  const secretAccessKey = process.env['CLOUDFLARE_SECRET_ACCESS_KEY'] ?? process.env['R2_SECRET_ACCESS_KEY'];
  const bucket = process.env['OCTO_R2_BUCKET'] ?? process.env['R2_BUCKET'] ?? 'octo';

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'MISSING_R2_CREDENTIALS: S3_API_ENDPOINT or R2_ENDPOINT, ACCESS_KEY_ID or R2_ACCESS_KEY_ID, and CLOUDFLARE_SECRET_ACCESS_KEY or R2_SECRET_ACCESS_KEY are required'
    );
  }

  return {
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucket,
    region: 'auto',
  };
}

export class R2StorageProvider {
  private client: S3Client;
  public readonly bucket: string;

  constructor(config: R2StorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region ?? 'auto',
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    });
  }

  /**
   * Uploads raw bytes to the R2 bucket.
   */
  async putObject(
    key: string,
    body: Uint8Array | Buffer | string,
    contentType = 'application/octet-stream'
  ): Promise<PutObjectResult> {
    const data = typeof body === 'string' ? Buffer.from(body, 'utf-8') : body;
    const sizeBytes = data.byteLength;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
    });

    const response = await this.client.send(command);

    return {
      key,
      sizeBytes,
      etag: response.ETag,
    };
  }

  /**
   * Retrieves an object from the R2 bucket as a byte array.
   */
  async getObject(key: string): Promise<GetObjectResult> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.client.send(command);

    if (!response.Body) {
      throw new Error(`OBJECT_EMPTY: Object ${key} has no content`);
    }

    const data = await response.Body.transformToByteArray();

    return {
      key,
      data,
      contentType: response.ContentType,
      contentLength: response.ContentLength,
    };
  }

  /**
   * Deletes an object from the R2 bucket.
   */
  async deleteObject(key: string): Promise<void> {
    await this.deleteObjectInBucket(this.bucket, key);
  }

  /** Deletes one object in a named bucket. Used for the public bucket, not a listing. */
  async deleteObjectInBucket(bucket: string, key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    await this.client.send(command);
  }

  /**
   * Copies one private object into another bucket under a new key.
   * Content type is replaced from the catalog so the public object is not
   * served as a generic byte stream.
   */
  async copyToBucket(
    destBucket: string,
    sourceKey: string,
    destKey: string,
    contentType: string
  ): Promise<void> {
    const command = new CopyObjectCommand(
      buildPublicCopyInput({
        sourceBucket: this.bucket,
        sourceKey,
        destBucket,
        destKey,
        contentType,
      })
    );
    await this.client.send(command);
  }

  /**
   * Checks existence and metadata of an object without downloading bytes.
   */
  async headObject(
    key: string
  ): Promise<{ contentLength?: number; contentType?: string; etag?: string } | null> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.client.send(command);

      return {
        contentLength: response.ContentLength,
        contentType: response.ContentType,
        etag: response.ETag,
      };
    } catch {
      return null;
    }
  }

  /**
   * Generates a short-lived presigned URL for direct secure downloading.
   */
  async generatePresignedDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  /**
   * Generates a short-lived presigned URL for direct secure uploading.
   */
  async generatePresignedUploadUrl(
    key: string,
    contentType: string,
    expiresInSeconds = 3600
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  /**
   * Lists objects under a prefix.
   */
  async listObjects(prefix = '', limit = 100): Promise<ObjectSummary[]> {
    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
      MaxKeys: limit,
    });

    const response = await this.client.send(command);

    if (!response.Contents) {
      return [];
    }

    return response.Contents.map((item) => ({
      key: item.Key ?? '',
      size: item.Size ?? 0,
      lastModified: item.LastModified,
      etag: item.ETag,
    }));
  }

  /**
   * Smoke test / health check against the live bucket.
   */
  async testConnection(): Promise<{ connected: boolean; bucket: string; error?: string }> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        MaxKeys: 1,
      });
      await this.client.send(command);
      return { connected: true, bucket: this.bucket };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { connected: false, bucket: this.bucket, error: message };
    }
  }
}
