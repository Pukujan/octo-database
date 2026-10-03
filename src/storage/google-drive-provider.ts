/**
 * Google Drive Archival Storage Adapter (Slice 5)
 *
 * Cold/archival tier for Octo, reached through Google Drive v3 REST using a
 * server-side OAuth 2.0 refresh token with the minimal `drive.file` scope.
 * Credentials stay server-side: browsers and agents only ever see the logical
 * file id.
 *
 * Fails closed when credentials are absent, matching `loadR2ConfigFromEnv`, so a
 * deployment without Drive configured reports a clear error rather than silently
 * archiving nowhere.
 */

import crypto from 'node:crypto';

export interface GoogleDriveConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** Optional app-controlled archive folder. */
  folderId?: string;
}

/**
 * The cold tier as the lifecycle needs it. Narrow on purpose so the archive
 * service can be exercised against a fake without live Drive credentials.
 */
export interface ArchiveStore {
  readonly label: string;
  /** Uploads bytes, or updates an existing locator, and returns its identifier. */
  put(
    name: string,
    bytes: Buffer,
    mimeType: string,
    existingLocator?: string | null
  ): Promise<{ locator: string; sizeBytes: number }>;
  get(locator: string): Promise<{ data: Buffer; sizeBytes: number; mimeType: string }>;
  delete(locator: string): Promise<void>;
  exists(locator: string): Promise<boolean>;
}

/**
 * Loads Google Drive configuration from the environment. Fails closed: archival
 * is unavailable rather than half-configured.
 */
export function loadGoogleDriveConfigFromEnv(): GoogleDriveConfig {
  const clientId = process.env['GOOGLE_DRIVE_CLIENT_ID'];
  const clientSecret = process.env['GOOGLE_DRIVE_CLIENT_SECRET'];
  const refreshToken = process.env['GOOGLE_DRIVE_REFRESH_TOKEN'];
  const folderId = process.env['GOOGLE_DRIVE_FOLDER_ID'];

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'MISSING_DRIVE_CREDENTIALS: GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, and GOOGLE_DRIVE_REFRESH_TOKEN are required'
    );
  }

  return { clientId, clientSecret, refreshToken, folderId };
}

export function sha256Hex(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export class GoogleDriveProvider implements ArchiveStore {
  readonly label = 'google_drive';

  private cachedAccessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly config: GoogleDriveConfig) {}

  /** Exchanges the stored refresh token for a short-lived access token. */
  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.cachedAccessToken && this.tokenExpiresAt > now + 60_000) {
      return this.cachedAccessToken;
    }

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      refresh_token: this.config.refreshToken,
      grant_type: 'refresh_token',
    });

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`DRIVE_AUTH_FAILED (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as { access_token: string; expires_in: number };
    this.cachedAccessToken = data.access_token;
    this.tokenExpiresAt = now + data.expires_in * 1000;
    return this.cachedAccessToken;
  }

  /**
   * Uploads bytes to the archive area. When `existingLocator` is supplied the
   * existing object is updated in place, so a retried archive never creates a
   * second copy of the same logical file.
   */
  async put(
    name: string,
    bytes: Buffer,
    mimeType = 'application/octet-stream',
    existingLocator?: string | null
  ): Promise<{ locator: string; sizeBytes: number }> {
    const token = await this.getAccessToken();
    const sha256 = sha256Hex(bytes);

    if (existingLocator) {
      const updateRes = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files/${existingLocator}?uploadType=media`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': mimeType },
          body: new Uint8Array(bytes),
        }
      );
      if (updateRes.ok) {
        return { locator: existingLocator, sizeBytes: bytes.byteLength };
      }
      // Fall through to a fresh create when the locator no longer exists.
    }

    const metadata: Record<string, unknown> = {
      name,
      mimeType,
      description: `Octo archived object [sha256:${sha256}]`,
      appProperties: { octoSha256: sha256 },
    };
    if (this.config.folderId) {
      metadata['parents'] = [this.config.folderId];
    }

    const boundary = `----OctoDriveBoundary${Date.now()}`;
    const multipartBody = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
          `--${boundary}\r\n` +
          `Content-Type: ${mimeType}\r\n\r\n`,
        'utf-8'
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8'),
    ]);

    const uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,size',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: new Uint8Array(multipartBody),
      }
    );

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error(`DRIVE_UPLOAD_FAILED (${uploadRes.status}): ${err}`);
    }

    const created = (await uploadRes.json()) as { id: string };
    return { locator: created.id, sizeBytes: bytes.byteLength };
  }

  async get(locator: string): Promise<{ data: Buffer; sizeBytes: number; mimeType: string }> {
    const token = await this.getAccessToken();
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${locator}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`DRIVE_DOWNLOAD_FAILED (${res.status}): ${err}`);
    }

    const data = Buffer.from(await res.arrayBuffer());
    return {
      data,
      sizeBytes: data.byteLength,
      mimeType: res.headers.get('content-type') ?? 'application/octet-stream',
    };
  }

  async delete(locator: string): Promise<void> {
    const token = await this.getAccessToken();
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${locator}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    // A missing archive object is already the desired end state.
    if (res.status === 404 || res.status === 204 || res.ok) return;

    const err = await res.text();
    throw new Error(`DRIVE_DELETE_FAILED (${res.status}): ${err}`);
  }

  async exists(locator: string): Promise<boolean> {
    const token = await this.getAccessToken();
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${locator}?fields=id,trashed`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!res.ok) return false;
    const info = (await res.json()) as { id?: string; trashed?: boolean };
    return Boolean(info.id && !info.trashed);
  }
}
