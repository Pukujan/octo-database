/**
 * Static asset serving for the standalone/production server.
 *
 * The caller has already resolved and guarded the path (traversal check,
 * existsSync, isFile). This helper owns the read itself, because a read can still
 * fail after those guards — the file is deleted, permissions change, or the disk
 * errors between the check and the open. A ReadStream with no 'error' handler
 * emits an unhandled error, which is an uncaught exception that takes down the
 * whole server process rather than failing the one response, so the failure is
 * confined to this request.
 */

import * as fs from 'fs';
import { ServerResponse } from 'http';

export function sendStaticFile(
  res: ServerResponse,
  filePath: string,
  contentType: string
): void {
  const stream = fs.createReadStream(filePath);

  stream.once('error', () => {
    if (res.destroyed) return;
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
    }
    if (!res.writableEnded) {
      res.end(JSON.stringify({ error: 'STATIC_READ_FAILED' }));
    }
  });

  stream.once('open', () => {
    // A client that disconnected before the file opened must not have writeHead
    // called on its destroyed response — that would throw inside this callback,
    // outside the request handler's try/catch.
    if (res.destroyed) {
      stream.destroy();
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    stream.pipe(res);
  });
}
