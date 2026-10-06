/**
 * Unit tests: outer-500 operational capture (issue #140, slice O1).
 *
 * The second capture site is the request handler's outer catch: any error that
 * escapes route dispatch must be recorded as one structured `request.error`
 * event before the 500 is sent. `/health` is the cheapest unauthenticated route
 * that reaches a database call, so a throwing `testDbConnection` forces exactly
 * that path without inventing a test-only route.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';

vi.mock('../../src/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/server/db')>();
  return {
    ...actual,
    testDbConnection: vi.fn(async () => {
      throw new Error('forced-db-failure');
    }),
    dbRecordOpsEvent: vi.fn(async () => {}),
  };
});

import { server } from '../../src/server/index';
import { dbRecordOpsEvent } from '../../src/server/db';

describe('outer-500 operational capture', () => {
  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  beforeEach(() => {
    vi.mocked(dbRecordOpsEvent).mockClear();
  });

  it('records one request.error event when a route throws, then answers 500', async () => {
    const response = await fetch(`${baseUrl}/health`);
    expect(response.status).toBe(500);

    const record = vi.mocked(dbRecordOpsEvent);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      workspaceId: null,
      source: 'api',
      eventType: 'request.error',
      errorCode: 'INTERNAL_SERVER_ERROR',
      severity: 'error',
      detail: {
        message: 'forced-db-failure',
        method: 'GET',
        path: '/health',
      },
      route: 'GET /health',
    });
  });
});
