/**
 * Backend-agnostic object storage contract (Slice 3)
 *
 * Lets derived artifacts (thumbnails) be written and served identically whether
 * bytes live in Cloudflare R2 or the explicit local CI/dev backend.
 */

import * as fs from 'fs';
import * as path from 'path';
import { R2StorageProvider } from './r2-client';

export interface ObjectStore {
  readonly label: string;
  /** Returns byte length when the object exists, otherwise null. */
  head(key: string): Promise<number | null>;
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export class R2ObjectStore implements ObjectStore {
  readonly label = 'r2';
  constructor(private readonly provider: R2StorageProvider) {}

  async head(key: string): Promise<number | null> {
    const meta = await this.provider.headObject(key);
    return meta ? (meta.contentLength ?? 0) : null;
  }

  async put(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.provider.putObject(key, bytes, contentType);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const result = await this.provider.getObject(key);
      return Buffer.from(result.data);
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await this.provider.deleteObject(key);
  }
}

export class LocalObjectStore implements ObjectStore {
  readonly label = 'local';
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    // Reject traversal: resolved path must stay inside the storage root.
    const target = path.resolve(this.root, key);
    const rootWithSep = path.resolve(this.root) + path.sep;
    if (!target.startsWith(rootWithSep)) {
      throw new Error(`UNSAFE_OBJECT_KEY: ${key}`);
    }
    return target;
  }

  async head(key: string): Promise<number | null> {
    const target = this.resolve(key);
    if (!fs.existsSync(target)) return null;
    return fs.statSync(target).size;
  }

  async put(key: string, bytes: Buffer, _contentType: string): Promise<void> {
    const target = this.resolve(key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
  }

  async get(key: string): Promise<Buffer | null> {
    const target = this.resolve(key);
    if (!fs.existsSync(target)) return null;
    return fs.readFileSync(target);
  }

  async delete(key: string): Promise<void> {
    const target = this.resolve(key);
    if (fs.existsSync(target)) fs.unlinkSync(target);
  }
}
