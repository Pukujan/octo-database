/**
 * Resolves the public origin a request reached Octo through.
 *
 * The server listens on a loopback port behind Caddy, so `req.url`'s origin is
 * useless for anything the browser or an external client must call back on:
 * OAuth redirect URIs, the issuer in metadata, and the metadata URLs in a 401
 * challenge all have to name the public origin.
 *
 * Lives in lib rather than the server module so the OAuth routes can use it
 * without importing the server (which imports them).
 */

import { IncomingMessage } from 'http';

export function getPublicOrigin(req: IncomingMessage, url: URL): string {
  const publicBase = process.env['PUBLIC_BASE_URL'];
  if (publicBase) {
    return publicBase.replace(/\/+$/, '');
  }
  const hostHeader = req.headers['x-forwarded-host'] ?? req.headers.host;
  if (hostHeader) {
    const host = (Array.isArray(hostHeader) ? hostHeader[0] : hostHeader).split(',')[0]!.trim();
    const protoHeader = req.headers['x-forwarded-proto'];
    const proto = protoHeader
      ? (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader).split(',')[0]!.trim()
      : 'http';
    return `${proto}://${host}`;
  }
  return url.origin;
}
