/**
 * Vector export: pgvector rows -> newline-delimited JSON for object storage.
 *
 * Keeps the derived RAG data (chunks + embeddings) portable: the canonical
 * Postgres schema owns it, and this produces a flat, storage-agnostic copy that
 * can be shipped to R2/S3 for backup, analysis, or reload elsewhere. The pure
 * serialization lives here; the CLI supplies rows and performs the upload.
 */

export interface VectorRow {
  id: string;
  workspaceId: string;
  documentId?: string;
  documentVersionId?: string;
  chunkIndex: number;
  chunkKey?: string;
  text: string;
  model?: string;
  modelVersion?: string;
  embedding: number[];
}

/** Parses the pgvector text form (`[0.1,0.2]`) into a number array. */
export function parseVector(text: string): number[] {
  const trimmed = text.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (!trimmed) return [];
  return trimmed.split(',').map((value) => Number(value));
}

/** Serializes rows as newline-delimited JSON (one object per line). */
export function toJsonl(rows: VectorRow[]): string {
  if (rows.length === 0) return '';
  return rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
}

/** The object-storage key for an export, dated so runs never overwrite. */
export function exportObjectKey(prefix: string, date: Date): string {
  const stamp = date.toISOString().replace(/[:.]/g, '-');
  return `${prefix.replace(/\/+$/, '')}/${stamp}.jsonl`;
}
