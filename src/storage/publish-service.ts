/**
 * Explicit publish of one workspace file onto a separate public target.
 *
 * The private bucket is never the public target. Publishing copies bytes; it
 * does not move them, list the public bucket, or sign a URL.
 */

export type PublishRefusal = 'FILE_NOT_ACTIVE' | 'OBJECT_MISSING';

export type PublishSnapshotResult =
  | { ok: true; url: string; publicKey: string }
  | { ok: false; code: PublishRefusal };

export class PublishStepError extends Error {
  readonly code: 'PUBLIC_COPY_FAILED' | 'PUBLIC_DELETE_FAILED';

  constructor(code: 'PUBLIC_COPY_FAILED' | 'PUBLIC_DELETE_FAILED', message: string) {
    super(message);
    this.code = code;
  }
}

export interface PublicTarget {
  mode: 'local' | 'r2';
  baseUrl: string;
  /** Set only for the R2 target. Local mode ignores any public bucket name. */
  publicBucket: string | null;
}

/** Stable public URL: one path segment, the file id, after the configured base. */
export function publishedFileUrl(baseUrl: string, fileId: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  return `${base}/${fileId}`;
}

/**
 * Accepts an origin, or an origin plus a path. Rejects a query, a fragment,
 * and anything that is not http(s). Trailing slashes are stripped.
 */
export function normalizePublicBase(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.search || url.hash) return null;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path === '/' ? '' : path}`;
}

/**
 * Local CI publishes without Cloudflare: the base defaults to this server's
 * public-file route and a public bucket name is ignored. R2 mode requires a
 * distinct public bucket and a base URL, and never falls back to the private
 * bucket name.
 */
export function resolvePublicTarget(
  env: NodeJS.ProcessEnv,
  options: { useLocalStorage: boolean; privateBucket: string; port: number }
): PublicTarget | null {
  if (options.useLocalStorage) {
    const configured = env['OCTO_PUBLIC_FILES_BASE'];
    const base =
      configured && configured.trim()
        ? normalizePublicBase(configured)
        : `http://127.0.0.1:${options.port}/public/files`;
    if (!base) return null;
    return { mode: 'local', baseUrl: base, publicBucket: null };
  }

  const bucket = (env['OCTO_PUBLIC_R2_BUCKET'] ?? '').trim();
  const baseRaw = (env['OCTO_PUBLIC_FILES_BASE'] ?? '').trim();
  if (!bucket || !baseRaw) return null;
  if (bucket === options.privateBucket) return null;
  const base = normalizePublicBase(baseRaw);
  if (!base) return null;
  return { mode: 'r2', baseUrl: base, publicBucket: bucket };
}

/**
 * Copies the active bytes to the public key (the file id). An archived file
 * is refused here and is not restored. `copyDirect` is the R2 CopyObject path;
 * without it the caller supplies the active bytes and `writePublic` stores them.
 */
export async function publishSnapshot(input: {
  fileId: string;
  mimeType: string;
  archiveState: string;
  baseUrl: string;
  activeBytes: Buffer | null;
  writePublic: (publicKey: string, bytes: Buffer, contentType: string) => Promise<void>;
  copyDirect?: () => Promise<void>;
}): Promise<PublishSnapshotResult> {
  if (input.archiveState !== 'active_r2') {
    return { ok: false, code: 'FILE_NOT_ACTIVE' };
  }

  const publicKey = input.fileId;
  try {
    if (input.copyDirect) {
      await input.copyDirect();
    } else if (input.activeBytes === null) {
      return { ok: false, code: 'OBJECT_MISSING' };
    } else {
      await input.writePublic(publicKey, input.activeBytes, input.mimeType);
    }
  } catch (err) {
    if (err instanceof PublishStepError) throw err;
    throw new PublishStepError(
      'PUBLIC_COPY_FAILED',
      'PUBLIC_COPY_FAILED: the public object could not be written'
    );
  }

  return { ok: true, url: publishedFileUrl(input.baseUrl, publicKey), publicKey };
}

/**
 * Removes the public object. A file that was never published does not touch
 * storage. A second call with both fields cleared is a no-op.
 */
export async function clearPublishedObject(input: {
  publishedAt: string | Date | null;
  publicKey: string | null;
  deletePublic: (publicKey: string) => Promise<void>;
}): Promise<{ deleted: boolean }> {
  if (input.publishedAt == null && input.publicKey == null) {
    return { deleted: false };
  }
  const publicKey = input.publicKey;
  if (!publicKey) {
    throw new PublishStepError(
      'PUBLIC_DELETE_FAILED',
      'PUBLIC_DELETE_FAILED: the public object could not be removed'
    );
  }
  try {
    await input.deletePublic(publicKey);
  } catch (err) {
    if (err instanceof PublishStepError) throw err;
    throw new PublishStepError(
      'PUBLIC_DELETE_FAILED',
      'PUBLIC_DELETE_FAILED: the public object could not be removed'
    );
  }
  return { deleted: true };
}
