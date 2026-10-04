/**
 * Slugs for auto-provisioned workspaces.
 *
 * Both helpers must carry the FULL identifier, not a prefix. octo.workspaces.slug
 * is UNIQUE and the provisioning insert ends in
 * `ON CONFLICT (slug) DO UPDATE ... RETURNING`, so a colliding slug returns the
 * existing row's id and the caller's `dbInsertMembership(..., 'owner')` then grants
 * the new signup ownership of a stranger's workspace. Truncating a UUID to its first
 * 8 characters (32 bits) makes that collision a live possibility across signups;
 * using the whole id (122 bits) makes it unreachable.
 */

export function guestSlug(authUserId: string): string {
  return `guest-${authUserId}`;
}

export function personalSlug(principalId: string): string {
  return `personal-${principalId}`;
}
