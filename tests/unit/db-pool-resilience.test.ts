/**
 * Unit tests: Postgres pool resilience.
 *
 * The hosted runtime is a single process, so an error on an idle pooled client
 * (server restart, network reset, admin termination) has to be handled: with no
 * 'error' listener, Node rethrows the event as an uncaught exception and the
 * container exits, dropping every in-flight request. These tests pin the two
 * guards that keep a transient database blip from taking the whole host down.
 */

import { describe, expect, it } from 'vitest';
import { dbPool } from '../../src/server/db';

describe('dbPool resilience', () => {
  it('handles an idle-client error instead of rethrowing it as an uncaught exception', () => {
    // Node's EventEmitter rethrows an 'error' event that has no listener, which
    // is what crashes the process; with a handler attached this call returns.
    expect(() => dbPool.emit('error', new Error('idle client terminated'))).not.toThrow();
  });

  it('bounds how long a connection attempt can hang', () => {
    expect(dbPool.options.connectionTimeoutMillis).toBeGreaterThan(0);
  });
});
