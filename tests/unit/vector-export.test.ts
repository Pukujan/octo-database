/**
 * Unit tests: vector export serialization.
 *
 * The export turns pgvector rows (chunks + embeddings) into newline-delimited
 * JSON suitable for object storage. These are the pure pieces: parsing the
 * pgvector text form, serializing rows, and choosing the object key.
 */

import { describe, expect, it } from 'vitest';
import { parseVector, toJsonl, exportObjectKey } from '../../src/backup/vector-export';

describe('parseVector', () => {
  it('parses the pgvector text form into numbers', () => {
    expect(parseVector('[0.1,0.2,0.3]')).toEqual([0.1, 0.2, 0.3]);
  });

  it('parses an empty vector', () => {
    expect(parseVector('[]')).toEqual([]);
  });

  it('handles scientific notation and negatives', () => {
    expect(parseVector('[-1.5e-3,2]')).toEqual([-0.0015, 2]);
  });
});

describe('toJsonl', () => {
  it('emits one JSON object per line with a trailing newline', () => {
    const jsonl = toJsonl([
      { id: 'c1', workspaceId: 'w1', chunkIndex: 0, text: 'hello', embedding: [0.1] },
      { id: 'c2', workspaceId: 'w1', chunkIndex: 1, text: 'world', embedding: [0.2] },
    ]);
    const lines = jsonl.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toEqual({
      id: 'c1',
      workspaceId: 'w1',
      chunkIndex: 0,
      text: 'hello',
      embedding: [0.1],
    });
    expect(jsonl.endsWith('\n')).toBe(true);
  });

  it('is empty for no rows', () => {
    expect(toJsonl([])).toBe('');
  });
});

describe('exportObjectKey', () => {
  it('places exports under a dated prefix with a stable extension', () => {
    const key = exportObjectKey('exports/vectors', new Date('2026-10-04T05:06:07.000Z'));
    expect(key).toBe('exports/vectors/2026-10-04T05-06-07-000Z.jsonl');
  });
});
