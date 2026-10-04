/**
 * Export pgvector data (RAG chunks + embeddings) to object storage.
 *
 * Reads the derived RAG tables from Postgres and writes one newline-delimited
 * JSON object per chunk, then uploads it to the configured S3/R2 bucket. The
 * canonical data stays in Postgres; this is a portable copy for backup,
 * analysis, or reload. Read-only against the database.
 *
 * Usage:
 *   DATABASE_URL=... npm run export-vectors -- --out ./vectors.jsonl   # local file
 *   DATABASE_URL=... S3_API_ENDPOINT=... ACCESS_KEY_ID=... \
 *     CLOUDFLARE_SECRET_ACCESS_KEY=... OCTO_R2_BUCKET=... npm run export-vectors
 *
 * Env:
 *   OCTO_VECTOR_EXPORT_PREFIX   object key prefix (default exports/vectors)
 */

import { writeFileSync } from 'node:fs';
import { Pool } from 'pg';
import { loadR2ConfigFromEnv, R2StorageProvider } from '../src/storage/r2-client';
import { parseVector, toJsonl, exportObjectKey, type VectorRow } from '../src/backup/vector-export';

const DATABASE_URL = process.env['DATABASE_URL'];
const PREFIX = process.env['OCTO_VECTOR_EXPORT_PREFIX'] ?? 'exports/vectors';
const outIndex = process.argv.indexOf('--out');
const OUT_FILE = outIndex >= 0 ? process.argv[outIndex + 1] : undefined;

async function loadRows(pool: Pool): Promise<VectorRow[]> {
  const { rows } = await pool.query<{
    id: string;
    workspace_id: string;
    document_id: string | null;
    document_version_id: string;
    chunk_index: number;
    chunk_key: string;
    text: string;
    model: string | null;
    model_version: string | null;
    embedding: string;
  }>(
    `SELECT c.id, c.workspace_id, dv.document_id, c.document_version_id,
            c.chunk_index, c.chunk_key, c.content AS text,
            ec.model, ec.model_version, e.embedding::text AS embedding
       FROM octo.chunks c
       JOIN octo.embeddings e ON e.chunk_id = c.id
       JOIN octo.document_versions dv ON dv.id = c.document_version_id
       LEFT JOIN octo.embedding_configs ec ON ec.id = e.config_id
      ORDER BY c.workspace_id, c.document_version_id, c.chunk_index`
  );

  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    documentId: row.document_id ?? undefined,
    documentVersionId: row.document_version_id,
    chunkIndex: row.chunk_index,
    chunkKey: row.chunk_key,
    text: row.text,
    model: row.model ?? undefined,
    modelVersion: row.model_version ?? undefined,
    embedding: parseVector(row.embedding),
  }));
}

async function main(): Promise<void> {
  if (!DATABASE_URL) {
    console.error('DATABASE_URL is required.');
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  let rows: VectorRow[];
  try {
    rows = await loadRows(pool);
  } catch (error) {
    console.error(
      `Vector export failed to read octo.chunks/octo.embeddings: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
    return;
  } finally {
    await pool.end();
  }

  const jsonl = toJsonl(rows);
  const key = exportObjectKey(PREFIX, new Date());

  if (OUT_FILE) {
    writeFileSync(OUT_FILE, jsonl);
    console.log(JSON.stringify({ mode: 'file', out: OUT_FILE, rows: rows.length, bytes: Buffer.byteLength(jsonl) }));
    return;
  }

  let config;
  try {
    config = loadR2ConfigFromEnv();
  } catch (error) {
    console.error(
      `S3/R2 credentials not configured (${error instanceof Error ? error.message : String(error)}); pass --out <file> to write locally.`
    );
    process.exitCode = 1;
    return;
  }

  const provider = new R2StorageProvider(config);
  await provider.putObject(key, Buffer.from(jsonl, 'utf8'), 'application/x-ndjson');
  console.log(JSON.stringify({ mode: 's3', bucket: config.bucket, key, rows: rows.length, bytes: Buffer.byteLength(jsonl) }));
}

await main();
