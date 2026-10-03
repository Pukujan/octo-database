/**
 * Archive Lifecycle Service (Slice 5)
 *
 * Moves a file's bytes between the active tier (R2) and the cold tier (Google
 * Drive) without changing its logical file id. The ordering is the whole point:
 *
 *   copy -> verify the destination -> persist canonical state -> only then
 *   delete the source.
 *
 * The only verified copy of a file is never deleted. When a step fails after the
 * copy but before the canonical transition, both copies are preserved and the
 * file is marked `reconciliation_required` rather than guessed at.
 */

import { createHash } from 'crypto';
import { ObjectStore } from './object-store';
import { ArchiveStore } from './google-drive-provider';

export type ArchiveState =
  | 'active_r2'
  | 'archiving'
  | 'archived_drive'
  | 'restoring'
  | 'reconciliation_required';

export interface ArchiveFileRecord {
  fileId: string;
  workspaceId: string;
  name: string;
  mimeType: string;
  storageKey: string;
  archiveState: ArchiveState;
  archiveLocator: string | null;
  archiveHash: string | null;
}

/** The subset of `octo.files` columns a lifecycle step may persist. */
export interface ArchiveTransition {
  archiveState: ArchiveState;
  archiveProvider?: string;
  archiveLocator?: string | null;
  archiveHash?: string | null;
  archivedAt?: string | null;
  lastVerifiedAt?: string | null;
}

export interface ArchiveDeps {
  active: ObjectStore;
  archive: ArchiveStore;
  updateFile: (fileId: string, patch: ArchiveTransition) => Promise<void>;
}

export type ArchiveResult =
  | { ok: true; detail: string; reused: boolean }
  | { ok: false; code: string; summary: string; reconciliationRequired: boolean };

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Confirms the cold tier holds exactly the bytes we expect. A locator that
 * cannot be read back, or that reads back different bytes, is not a durable copy.
 */
async function archiveHoldsBytes(
  archive: ArchiveStore,
  locator: string,
  expectedSize: number,
  expectedHash: string
): Promise<boolean> {
  try {
    const found = await archive.get(locator);
    return found.sizeBytes === expectedSize && sha256Hex(found.data) === expectedHash;
  } catch {
    return false;
  }
}

/**
 * Archives a file: R2 -> Drive, verifying the destination before the source is
 * touched. Idempotent: an already-archived file with an intact cold copy is
 * reused, and any stale active copy left by a previous prune failure is removed.
 */
export async function archiveFile(
  deps: ArchiveDeps,
  record: ArchiveFileRecord
): Promise<ArchiveResult> {
  const { fileId, name, mimeType, storageKey } = record;

  // Already archived: converge rather than copy a second time.
  if (record.archiveState === 'archived_drive' && record.archiveLocator) {
    const active = await deps.active.get(storageKey);
    if (active) {
      const hash = sha256Hex(active);
      if (await archiveHoldsBytes(deps.archive, record.archiveLocator, active.byteLength, hash)) {
        // Cold copy is verified; a lingering active copy is safe to prune now.
        try {
          await deps.active.delete(storageKey);
          return { ok: true, detail: `already archived (${fileId}); stale active copy pruned`, reused: true };
        } catch (err) {
          return {
            ok: false,
            code: 'ACTIVE_DELETE_FAILED',
            summary: `Archived but could not prune the active copy: ${errText(err)}`,
            reconciliationRequired: true,
          };
        }
      }
    } else if (await deps.archive.exists(record.archiveLocator)) {
      return { ok: true, detail: `already archived (${fileId})`, reused: true };
    }
    // Cold copy missing or unverifiable: fall through and re-archive from R2.
  }

  const bytes = await deps.active.get(storageKey);
  if (!bytes) {
    return {
      ok: false,
      code: 'ACTIVE_READ_FAILED',
      summary: `Active copy missing for ${storageKey}`,
      reconciliationRequired: false,
    };
  }

  const hash = sha256Hex(bytes);

  // Record intent before the copy so a crash mid-flight is visible.
  await deps.updateFile(fileId, { archiveState: 'archiving' });

  let uploaded: { locator: string };
  try {
    // Passing the known locator makes a retried archive update the existing cold
    // object instead of creating a second copy of the same logical file.
    uploaded = await deps.archive.put(name, bytes, mimeType, record.archiveLocator);
  } catch (err) {
    await deps.updateFile(fileId, { archiveState: 'active_r2' });
    return {
      ok: false,
      code: 'ARCHIVE_UPLOAD_FAILED',
      summary: `Google Drive upload failed: ${errText(err)}`,
      reconciliationRequired: false,
    };
  }

  // Verify the destination BEFORE deleting anything. A cold copy we cannot read
  // back is not durable, and the R2 source must survive.
  if (!(await archiveHoldsBytes(deps.archive, uploaded.locator, bytes.byteLength, hash))) {
    await deps.updateFile(fileId, {
      archiveState: 'reconciliation_required',
      archiveProvider: deps.archive.label,
      archiveLocator: uploaded.locator,
    });
    return {
      ok: false,
      code: 'ARCHIVE_VERIFY_FAILED',
      summary: `Uploaded copy could not be verified; both copies preserved (locator ${uploaded.locator})`,
      reconciliationRequired: true,
    };
  }

  // Persist the canonical transition. If this fails the bytes are safe in both
  // places, so preserve both and mark for reconciliation.
  try {
    await deps.updateFile(fileId, {
      archiveState: 'archived_drive',
      archiveProvider: deps.archive.label,
      archiveLocator: uploaded.locator,
      archiveHash: hash,
      archivedAt: new Date().toISOString(),
      lastVerifiedAt: new Date().toISOString(),
    });
  } catch (err) {
    await deps.updateFile(fileId, {
      archiveState: 'reconciliation_required',
      archiveProvider: deps.archive.label,
      archiveLocator: uploaded.locator,
    });
    return {
      ok: false,
      code: 'ARCHIVE_STATE_UPDATE_FAILED',
      summary: `Verified copy exists but canonical state update failed: ${errText(err)}`,
      reconciliationRequired: true,
    };
  }

  // Only now, with a verified durable copy and persisted state, remove the source.
  try {
    await deps.active.delete(storageKey);
  } catch (err) {
    // The archive succeeded; the lingering active copy is a benign duplicate that
    // a re-run prunes. Report it rather than pretending the prune happened.
    return {
      ok: true,
      detail: `archived to ${deps.archive.label} (${uploaded.locator}); active copy prune pending: ${errText(err)}`,
      reused: false,
    };
  }

  return {
    ok: true,
    detail: `archived to ${deps.archive.label} (${uploaded.locator})`,
    reused: false,
  };
}

/**
 * Restores a file: Drive -> R2, verifying the active write before the transition
 * is persisted. Idempotent: an already-active file is a no-op.
 */
export async function restoreFile(
  deps: ArchiveDeps,
  record: ArchiveFileRecord
): Promise<ArchiveResult> {
  const { fileId, mimeType, storageKey } = record;

  // Already active: nothing to restore.
  if (record.archiveState === 'active_r2') {
    const existing = await deps.active.head(storageKey);
    if (existing !== null) {
      return { ok: true, detail: `already active (${fileId})`, reused: true };
    }
  }

  if (!record.archiveLocator) {
    return {
      ok: false,
      code: 'INVALID_PAYLOAD',
      summary: `File ${fileId} has no archive locator to restore from`,
      reconciliationRequired: false,
    };
  }

  await deps.updateFile(fileId, { archiveState: 'restoring' });

  let cold: { data: Buffer; mimeType: string };
  try {
    cold = await deps.archive.get(record.archiveLocator);
  } catch (err) {
    await deps.updateFile(fileId, { archiveState: 'archived_drive' });
    return {
      ok: false,
      code: 'ARCHIVE_READ_FAILED',
      summary: `Google Drive read failed: ${errText(err)}`,
      reconciliationRequired: false,
    };
  }

  const hash = sha256Hex(cold.data);

  // A cold copy that no longer matches its recorded hash must not be trusted
  // back into the active tier as if it were the archived original.
  if (record.archiveHash && hash !== record.archiveHash) {
    await deps.updateFile(fileId, { archiveState: 'reconciliation_required' });
    return {
      ok: false,
      code: 'ARCHIVE_HASH_MISMATCH',
      summary: `Cold copy hash ${hash} does not match recorded ${record.archiveHash}`,
      reconciliationRequired: true,
    };
  }

  try {
    await deps.active.put(storageKey, cold.data, cold.mimeType || mimeType);
  } catch (err) {
    await deps.updateFile(fileId, { archiveState: 'archived_drive' });
    return {
      ok: false,
      code: 'RESTORE_WRITE_FAILED',
      summary: `Active-tier write failed: ${errText(err)}`,
      reconciliationRequired: false,
    };
  }

  // Verify the active write before declaring the file active again.
  const restored = await deps.active.get(storageKey);
  if (!restored || sha256Hex(restored) !== hash) {
    await deps.updateFile(fileId, { archiveState: 'reconciliation_required' });
    return {
      ok: false,
      code: 'RESTORE_VERIFY_FAILED',
      summary: `Restored bytes at ${storageKey} do not match the cold copy`,
      reconciliationRequired: true,
    };
  }

  // The cold copy is deliberately retained (locator, provider, and hash are kept)
  // so a restore never orphans the archived object. Restoring is a copy back, not
  // a move, which is the safe default the issue asks for.
  try {
    await deps.updateFile(fileId, {
      archiveState: 'active_r2',
      archiveProvider: deps.archive.label,
      archiveLocator: record.archiveLocator,
      archiveHash: hash,
      lastVerifiedAt: new Date().toISOString(),
    });
  } catch (err) {
    await deps.updateFile(fileId, { archiveState: 'reconciliation_required' });
    return {
      ok: false,
      code: 'RESTORE_STATE_UPDATE_FAILED',
      summary: `Restored bytes exist but canonical state update failed: ${errText(err)}`,
      reconciliationRequired: true,
    };
  }

  return { ok: true, detail: `restored from ${deps.archive.label} (${record.archiveLocator})`, reused: false };
}
