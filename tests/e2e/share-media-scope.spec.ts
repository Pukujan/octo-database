/**
 * Playwright E2E: a share-scoped media request must never widen into a
 * principal-scoped credential (ISS-3, deep audit 2026-10-05).
 *
 * The thumbnail route serves both bearer and share-token callers. When no
 * derivative can be produced (a video or other non-image, or a missing original)
 * it redirects to the full object. That fallback must keep the scope that
 * authorized the request: a logged-out share holder must get a share-scoped URL,
 * capped at the share's own expiry, not a principal-scoped URL embedding the
 * creator's UUID.
 */

import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

test.describe('Share media fallback scope (ISS-3)', () => {
  test('a non-image fallback stays share-scoped and capped at the share expiry', async ({
    request,
  }) => {
    const login = await request.post('/api/auth/guest', {
      data: { displayName: `Share Media ${randomUUID()}` },
    });
    expect(login.status()).toBe(201);
    const session = (await login.json()) as {
      sessionToken: string;
      workspace: { id: string };
    };
    const workspaceId = session.workspace.id;

    // A video is shared media but not an image, so the thumbnail route has no
    // derivative and takes the redirect fallback.
    const upload = await request.post('/api/files/upload', {
      headers: bearer(session.sessionToken),
      data: {
        workspaceId,
        name: 'share-media-clip.mp4',
        mimeType: 'video/mp4',
        data: Buffer.from('not-a-real-mp4').toString('base64'),
        dataEncoding: 'base64',
      },
    });
    expect(upload.status()).toBe(201);

    const validUntil = new Date(Date.now() + 120_000).toISOString();
    const created = await request.post('/api/workspaces/shares', {
      headers: bearer(session.sessionToken),
      data: { workspaceId, resourceType: 'gallery', permission: 'read', validUntil },
    });
    expect(created.status()).toBe(201);
    const { rawToken } = (await created.json()) as { rawToken: string };

    const publicView = await request.get(`/api/public/shares/${rawToken}`);
    expect(publicView.status()).toBe(200);
    const { items } = (await publicView.json()) as {
      items: { name: string; thumbnailUrl: string }[];
    };
    const clip = items.find((i) => i.name === 'share-media-clip.mp4');
    expect(clip).toBeTruthy();

    // Requesting the share-signed thumbnail (no Authorization) must redirect to a
    // share-scoped content URL, not a principal one.
    const thumb = await request.get(clip!.thumbnailUrl, { maxRedirects: 0 });
    expect(thumb.status()).toBe(302);
    const location = thumb.headers()['location'];
    expect(location).toBeTruthy();
    expect(location).toContain('shareId=');
    expect(location).not.toContain('principalId=');

    const parsed = new URL(location, 'http://localhost');
    const exp = Number(parsed.searchParams.get('exp'));
    const shareCap = Math.floor(new Date(validUntil).getTime() / 1000);
    // Capped at the share's expiry, and therefore well under the 1h default TTL.
    expect(exp).toBeLessThanOrEqual(shareCap);
    expect(exp).toBeLessThan(Math.floor(Date.now() / 1000) + 3600 - 60);
  });
});
