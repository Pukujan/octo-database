/**
 * Blind agent run for public publish (issue #175).
 *
 * Uses fetch only. Paths come from GET /api/capabilities. This file does not
 * import the server, the publish service, or the capability catalog.
 */

const base = process.env.OCTO_API_BASE || 'http://127.0.0.1:3001';

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

async function call(path, { method = 'GET', token, body, absolute = false } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(absolute ? path : `${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: response.status, text, json };
}

function bind(template, fileId, workspaceId) {
  return template.replaceAll('<fileId>', fileId).replaceAll('<id>', workspaceId);
}

const guest = await call('/api/auth/guest', {
  method: 'POST',
  body: { displayName: `blind-agent-${Date.now()}` },
});
if (guest.status !== 201 || !guest.json?.sessionToken || !guest.json?.workspace?.id) {
  fail(`guest login returned ${guest.status}`);
}
const token = guest.json.sessionToken;
const workspaceId = guest.json.workspace.id;

const discovery = await call(`/api/capabilities?workspaceId=${workspaceId}`, { token });
if (discovery.status !== 200) fail(`capabilities returned ${discovery.status}`);
const capabilities = discovery.json?.capabilities ?? [];
const publishCap = capabilities.find((item) => item.action === 'files.publish');
const unpublishCap = capabilities.find((item) => item.action === 'files.unpublish');
const uploadCap = capabilities.find((item) => item.action === 'files.upload');
if (!publishCap || publishCap.method !== 'POST' || publishCap.requiredScope !== 'write') {
  fail('files.publish was not advertised as POST write');
}
if (!unpublishCap || unpublishCap.method !== 'POST' || unpublishCap.requiredScope !== 'write') {
  fail('files.unpublish was not advertised as POST write');
}
if (!uploadCap || uploadCap.method !== 'POST') fail('files.upload was not advertised');

async function upload(name, data) {
  const uploaded = await call(uploadCap.path, {
    method: uploadCap.method,
    token,
    body: { workspaceId, name, mimeType: 'text/plain', data, dataEncoding: 'utf8' },
  });
  if (uploaded.status !== 201 || !uploaded.json?.id) fail(`upload ${name} returned ${uploaded.status}`);
  return uploaded.json.id;
}

const publishedBody = `blind-published-${Date.now()}`;
const siblingBody = `blind-sibling-${Date.now()}`;
const publishedId = await upload('blind-published.txt', publishedBody);
const siblingId = await upload('blind-sibling.txt', siblingBody);

const published = await call(bind(publishCap.path, publishedId, workspaceId), {
  method: publishCap.method,
  token,
});
if (published.status !== 200 || typeof published.json?.url !== 'string') {
  fail(`publish returned ${published.status} ${published.text}`);
}

const fetched = await call(published.json.url, { absolute: true });
if (fetched.status !== 200 || fetched.text !== publishedBody) {
  fail(`public fetch returned ${fetched.status}`);
}

const siblingUrl = published.json.url.replace(publishedId, siblingId);
const siblingFetch = await call(siblingUrl, { absolute: true });
if (siblingFetch.status !== 404) fail(`sibling public fetch returned ${siblingFetch.status}`);

const siblingPrivate = await call(
  `/api/files/content?workspaceId=${workspaceId}&fileId=${siblingId}`
);
if (siblingPrivate.status !== 401) fail(`anonymous content returned ${siblingPrivate.status}`);
const siblingAuthed = await call(
  `/api/files/content?workspaceId=${workspaceId}&fileId=${siblingId}`,
  { token }
);
if (siblingAuthed.status !== 200 || siblingAuthed.text !== siblingBody) {
  fail(`session content returned ${siblingAuthed.status}`);
}

const secret = await call('/api/me/confirm-secret', {
  method: 'POST',
  token,
  body: { secret: 'blind-agent-secret' },
});
if (secret.status !== 200) fail(`confirm secret returned ${secret.status} ${secret.text}`);

const key = await call('/api/keys', {
  method: 'POST',
  token,
  body: {
    name: 'blind read key',
    workspaceId,
    scopes: ['read', 'files'],
    confirmSecret: 'blind-agent-secret',
  },
});
if (key.status !== 201 || !key.json?.rawSecret) fail(`mint returned ${key.status} ${key.text}`);

const denied = await call(bind(publishCap.path, siblingId, workspaceId), {
  method: publishCap.method,
  token: key.json.rawSecret,
});
if (denied.status !== 403 || !String(denied.json?.error ?? '').includes('write')) {
  fail(`read-only publish returned ${denied.status} ${denied.text}`);
}

const unpublished = await call(bind(unpublishCap.path, publishedId, workspaceId), {
  method: unpublishCap.method,
  token,
});
if (unpublished.status !== 200) fail(`unpublish returned ${unpublished.status} ${unpublished.text}`);

const after = await call(published.json.url, { absolute: true });
if (after.status !== 404) fail(`url after unpublish returned ${after.status}`);

const stillThere = await call(
  `/api/files/content?workspaceId=${workspaceId}&fileId=${publishedId}`,
  { token }
);
if (stillThere.status !== 200 || stillThere.text !== publishedBody) {
  fail(`private read after unpublish returned ${stillThere.status}`);
}

console.log('OK');
