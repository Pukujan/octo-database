/**
 * Unit tests: the workspace SQL module's error classification and shape.
 *
 * The route maps a statement the database rejected (a syntax or constraint error)
 * to a 400 with Postgres's own message, and anything else to the outer 500 handler.
 * That split is decided by `isSqlError`, so it is pinned here: a `DatabaseError`
 * is a SQL error, and a connection or programming failure is not.
 */

import pg from 'pg';
import { describe, expect, it } from 'vitest';
import {
  isSqlError,
  sqlState,
  DEFAULT_ROW_LIMIT,
  MAX_ROW_LIMIT,
  DEFAULT_STATEMENT_TIMEOUT_MS,
} from '../../src/server/query';

describe('workspace SQL error classification', () => {
  it('treats a database error as a SQL error the caller caused', () => {
    const error = new pg.DatabaseError('syntax error at or near "SELEC"', 5, 'error');
    error.code = '42601';
    expect(isSqlError(error)).toBe(true);
    expect(sqlState(error)).toBe('42601');
  });

  it('does not treat a connection or programming failure as a SQL error', () => {
    expect(isSqlError(new Error('connection terminated unexpectedly'))).toBe(false);
    expect(isSqlError(new TypeError('x is not a function'))).toBe(false);
    expect(isSqlError(undefined)).toBe(false);
    expect(sqlState(new Error('nope'))).toBeUndefined();
  });

  it('bounds row limits so one response cannot be unbounded', () => {
    expect(DEFAULT_ROW_LIMIT).toBeGreaterThan(0);
    expect(MAX_ROW_LIMIT).toBeGreaterThanOrEqual(DEFAULT_ROW_LIMIT);
  });

  it('bounds how long one request may run', () => {
    expect(DEFAULT_STATEMENT_TIMEOUT_MS).toBeGreaterThan(0);
  });
});
