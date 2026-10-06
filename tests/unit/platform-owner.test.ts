/**
 * Unit Tests: Platform Owner Database & Authorization Logic
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as db from '../../src/server/db';

// Slice 14 moved the principal-read/authorize and pre-auth bootstrap paths onto
// `servicePool` (BYPASSRLS) instead of `dbPool` (fenced). These tests mock the pool
// those functions now actually query through.
describe('Platform Owner Database Authorization Logic', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('passes isOwner=true for the configured PLATFORM_OWNER_EMAIL', async () => {
    process.env['PLATFORM_OWNER_EMAIL'] = 'owner@example.test';
    try {
      let capturedParams: unknown[] = [];
      vi.spyOn(db.servicePool, 'connect').mockResolvedValue({
        query: vi.fn().mockImplementation(async (_sql: string, params: unknown[]) => {
          capturedParams = params;
          return {
            rows: [
              {
                id: 'principal-1',
                authUserId: 'google-sub-1',
                email: 'owner@example.test',
                displayName: 'Owner',
                avatarUrl: null,
                isGuest: false,
                isPlatformOwner: true,
              },
            ],
          };
        }),
        release: vi.fn(),
      } as any);

      const result = await db.dbUpsertGooglePrincipal(
        'google-sub-1',
        'Owner@Example.Test',
        'Owner',
        null
      );

      expect(result.isPlatformOwner).toBe(true);
      // Param index 4 (5th param: $5) is isOwner boolean
      expect(capturedParams[4]).toBe(true);
    } finally {
      delete process.env['PLATFORM_OWNER_EMAIL'];
    }
  });

  it('passes isOwner=false when no owner email is configured', async () => {
    delete process.env['PLATFORM_OWNER_EMAIL'];
    let capturedParams: unknown[] = [];
    vi.spyOn(db.servicePool, 'connect').mockResolvedValue({
      query: vi.fn().mockImplementation(async (_sql: string, params: unknown[]) => {
        capturedParams = params;
        return {
          rows: [
            {
              id: 'principal-2',
              authUserId: 'google-sub-2',
              email: 'other@example.com',
              displayName: 'Other',
              avatarUrl: null,
              isGuest: false,
              isPlatformOwner: false,
            },
          ],
        };
      }),
      release: vi.fn(),
    } as any);

    const result = await db.dbUpsertGooglePrincipal(
      'google-sub-2',
      'other@example.com',
      'Other',
      null
    );

    expect(result.isPlatformOwner).toBe(false);
    expect(capturedParams[4]).toBe(false);
  });

  it('grants owner role across all workspaces in dbGetAuthorizedWorkspaces for platform owners', async () => {
    vi.spyOn(db.servicePool, 'connect').mockResolvedValue({
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT is_platform_owner FROM octo.principals')) {
          return { rows: [{ is_platform_owner: true }] };
        }
        if (sql.includes('FROM octo.workspaces')) {
          return {
            rows: [
              { id: 'ws-1', slug: 'tenant-a', name: 'Tenant A', description: null, role: 'owner', isOwner: true },
              { id: 'ws-2', slug: 'tenant-b', name: 'Tenant B', description: null, role: 'owner', isOwner: true },
            ],
          };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    } as any);

    const workspaces = await db.dbGetAuthorizedWorkspaces('principal-owner-id');
    expect(workspaces.length).toBe(2);
    expect(workspaces.every((w) => w.role === 'owner' && w.isOwner === true)).toBe(true);
  });

  it('grants owner role for any workspace in dbGetWorkspaceMembership for platform owners', async () => {
    vi.spyOn(db.servicePool, 'connect').mockResolvedValue({
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT is_platform_owner FROM octo.principals')) {
          return { rows: [{ is_platform_owner: true }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    } as any);

    const membership = await db.dbGetWorkspaceMembership('any-workspace-id', 'principal-owner-id');
    expect(membership).not.toBeNull();
    expect(membership?.role).toBe('owner');
  });
});
