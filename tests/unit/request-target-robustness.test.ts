/**
 * Unit tests: request-target robustness (hosted runtime resilience).
 *
 * The hosted runtime is a single process. A malformed HTTP request line such as
 * `GET http://[ HTTP/1.1` makes `new URL(req.url, base)` throw ERR_INVALID_URL.
 * If that construction runs outside the request handler's try/catch, the throw
 * becomes an unhandled rejection and the container exits — a pre-auth, remote
 * denial of service reachable by any client that can open a socket. The handler
 * must answer the request instead of dying on it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection } from 'node:net';
import type { AddressInfo } from 'node:net';
import { server } from '../../src/server/index';

/** Sends a raw request line and resolves with whatever bytes come back. */
function rawRequest(port: number, requestLine: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(`${requestLine}\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('timed out waiting for a response'));
    }, 5000);
    socket.on('data', (chunk) => {
      data += chunk.toString();
    });
    socket.on('end', () => {
      clearTimeout(timer);
      resolve(data);
    });
    socket.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

describe('malformed request target', () => {
  let basePort: number;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        basePort = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('answers a malformed absolute-form request target instead of crashing', async () => {
    const response = await rawRequest(basePort, 'GET http://[ HTTP/1.1');
    expect(response).toMatch(/^HTTP\/1\.1 \d{3}/);
    expect(response).toContain('400');
  });
});
