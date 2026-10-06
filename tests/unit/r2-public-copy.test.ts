/**
 * Public-bucket copy command and target configuration (issue #175).
 *
 * The copy names a different bucket. It is not a list, and a public bucket
 * that is the private bucket is not a configured target.
 */

import { describe, expect, it } from 'vitest';
import { buildPublicCopyInput } from '../../src/storage/r2-client';
import { resolvePublicTarget } from '../../src/storage/publish-service';

const FILE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('public copy command', () => {
  it('copies one object into the public bucket with the catalog content type', () => {
    const input = buildPublicCopyInput({
      sourceBucket: 'octo',
      sourceKey: `workspaces/ws/${FILE_ID}/cover.png`,
      destBucket: 'octo-public',
      destKey: FILE_ID,
      contentType: 'image/png',
    });

    expect(input).toEqual({
      Bucket: 'octo-public',
      Key: FILE_ID,
      CopySource: `octo/workspaces/ws/${FILE_ID}/cover.png`,
      ContentType: 'image/png',
      MetadataDirective: 'REPLACE',
    });
    expect(Object.keys(input)).not.toContain('Prefix');
    expect(JSON.stringify(input)).not.toMatch(/ListObjects/);
  });

  it('encodes each key segment and leaves the slashes between them', () => {
    const input = buildPublicCopyInput({
      sourceBucket: 'octo private',
      sourceKey: 'workspaces/ws/my file.png',
      destBucket: 'octo-public',
      destKey: FILE_ID,
      contentType: 'image/png',
    });
    expect(input.CopySource).toBe('octo%20private/workspaces/ws/my%20file.png');
  });
});

describe('public target configuration', () => {
  it('is unset when the R2 public bucket or base is missing', () => {
    expect(
      resolvePublicTarget(
        {},
        { useLocalStorage: false, privateBucket: 'octo', port: 3001 }
      )
    ).toBeNull();
    expect(
      resolvePublicTarget(
        { OCTO_PUBLIC_R2_BUCKET: 'octo-public' },
        { useLocalStorage: false, privateBucket: 'octo', port: 3001 }
      )
    ).toBeNull();
    expect(
      resolvePublicTarget(
        { OCTO_PUBLIC_FILES_BASE: 'https://files.example.com' },
        { useLocalStorage: false, privateBucket: 'octo', port: 3001 }
      )
    ).toBeNull();
  });

  it('refuses a public bucket name equal to the private bucket', () => {
    expect(
      resolvePublicTarget(
        { OCTO_PUBLIC_R2_BUCKET: 'octo', OCTO_PUBLIC_FILES_BASE: 'https://files.example.com' },
        { useLocalStorage: false, privateBucket: 'octo', port: 3001 }
      )
    ).toBeNull();
    expect(
      resolvePublicTarget(
        {
          OCTO_PUBLIC_R2_BUCKET: 'named-private',
          OCTO_PUBLIC_FILES_BASE: 'https://files.example.com',
        },
        { useLocalStorage: false, privateBucket: 'named-private', port: 3001 }
      )
    ).toBeNull();
  });

  it('accepts a different bucket and a base with no query or fragment', () => {
    expect(
      resolvePublicTarget(
        {
          OCTO_PUBLIC_R2_BUCKET: 'octo-public',
          OCTO_PUBLIC_FILES_BASE: 'https://files.example.com/',
        },
        { useLocalStorage: false, privateBucket: 'octo', port: 3001 }
      )
    ).toEqual({
      mode: 'r2',
      baseUrl: 'https://files.example.com',
      publicBucket: 'octo-public',
    });
    expect(
      resolvePublicTarget(
        {
          OCTO_PUBLIC_R2_BUCKET: 'octo-public',
          OCTO_PUBLIC_FILES_BASE: 'https://files.example.com/cdn?x=1',
        },
        { useLocalStorage: false, privateBucket: 'octo', port: 3001 }
      )
    ).toBeNull();
  });

  it('uses the local route in local mode and ignores the public bucket name', () => {
    expect(
      resolvePublicTarget(
        { OCTO_PUBLIC_R2_BUCKET: 'octo' },
        { useLocalStorage: true, privateBucket: 'octo', port: 3001 }
      )
    ).toEqual({
      mode: 'local',
      baseUrl: 'http://127.0.0.1:3001/public/files',
      publicBucket: null,
    });
  });
});
