/**
 * Unit tests: slugs for auto-provisioned workspaces.
 *
 * octo.workspaces.slug is UNIQUE and dbInsertWorkspace resolves a clash with
 * `ON CONFLICT (slug) DO UPDATE ... RETURNING`, which returns the *existing*
 * row's id. The caller then grants owner membership on whatever id comes back,
 * so a truncated slug that collides hands a new guest ownership of another
 * tenant's workspace. These tests pin the property that makes that impossible:
 * the whole identifier, not a prefix, decides the slug.
 */

import { describe, expect, it } from 'vitest';
import { guestSlug, personalSlug } from '../../src/lib/provisioning-slug';

describe('guestSlug', () => {
  it('carries the full auth id instead of a truncated prefix', () => {
    const id = '3f2a1b6c-99d4-4e7f-8a2b-1c0d9e8f7a6b';
    expect(guestSlug(id)).toBe(`guest-${id}`);
  });

  it('gives two ids that share their first characters different slugs', () => {
    // The shape of the old defect: identical first 8 characters.
    const a = 'aaaaaaaa-1111-4111-8111-111111111111';
    const b = 'aaaaaaaa-2222-4222-8222-222222222222';
    expect(a.slice(0, 8)).toBe(b.slice(0, 8));
    expect(guestSlug(a)).not.toBe(guestSlug(b));
  });
});

describe('personalSlug', () => {
  it('carries the full principal id instead of a truncated prefix', () => {
    const id = '7c6b5a49-33e2-4d1f-9a0b-cd1234567890';
    expect(personalSlug(id)).toBe(`personal-${id}`);
  });

  it('gives two principals that share their first characters different slugs', () => {
    const a = 'bbbbbbbb-1111-4111-8111-111111111111';
    const b = 'bbbbbbbb-2222-4222-8222-222222222222';
    expect(a.slice(0, 8)).toBe(b.slice(0, 8));
    expect(personalSlug(a)).not.toBe(personalSlug(b));
  });
});
