import './styles.css';
import type { WorkspaceSummary, Principal } from './types/auth';
import type { FileRecord } from './storage/file-service';
import type { ApiKey } from './api/keys';
import type { GalleryItem } from './media/gallery-service';
import type { ShareSummary } from './media/share-service';

type View = 'overview' | 'files' | 'gallery' | 'operations' | 'access';
type Job = { id: string; jobType: string; state: string; attempts: number; maxAttempts: number; errorSummary?: string | null; createdAt: string; completedAt?: string | null };
type Activity = { id: string; eventType: string; summary: string; createdAt: string };
type Modal = 'workspace' | 'text-file' | 'key' | 'share' | 'workspace-created' | 'key-created' | 'share-created' | 'delete-workspace' | 'preview' | null;

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Octo app root is missing');

const state: {
  principal: Principal | null; token: string | null; workspaces: WorkspaceSummary[]; workspace: WorkspaceSummary | null;
  files: FileRecord[]; gallery: GalleryItem[]; keys: ApiKey[]; shares: ShareSummary[]; jobs: Job[]; activity: Activity[];
  googleAuthEnabled: boolean; confirmSecretSet: boolean; view: View; loading: boolean; theme: 'midnight' | 'paper';
  modal: Modal; modalError: string; oneTimeSecret: string; oneTimeLabel: string; shareUrl: string; previewItem: GalleryItem | null; notice: string;
} = {
  principal: null, token: null, workspaces: [], workspace: null, files: [], gallery: [], keys: [], shares: [], jobs: [], activity: [],
  googleAuthEnabled: false, confirmSecretSet: false, view: 'overview', loading: false,
  theme: localStorage.getItem('octo-design-system') === 'paper' ? 'paper' : 'midnight', modal: null, modalError: '',
  oneTimeSecret: '', oneTimeLabel: '', shareUrl: '', previewItem: null, notice: '',
};

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T | null => root!.querySelector<T>(selector);
const esc = (value: unknown): string => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const bytes = (value: number): string => value < 1024 ? value + ' B' : value < 1048576 ? (value / 1024).toFixed(1) + ' KB' : (value / 1048576).toFixed(1) + ' MB';
const date = (value?: string | null): string => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : '—';
const when = (value?: string | null): string => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const wsId = (): string => state.workspace?.id ?? '';

async function api<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (state.token) headers.set('Authorization', 'Bearer ' + state.token);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...init, headers });
  if (response.status === 401 && state.token && !path.startsWith('/api/auth/')) {
    clearSession();
    render();
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error ?? body.message ?? response.statusText ?? 'Request failed');
  }
  if (response.status === 204) return undefined as T;
  const type = response.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? response.json() : response.blob()) as Promise<T>;
}

function clearSession(): void {
  localStorage.removeItem('octo_token');
  localStorage.removeItem('octo_principal');
  state.token = null; state.principal = null; state.workspaces = []; state.workspace = null;
  state.files = []; state.gallery = []; state.keys = []; state.shares = []; state.jobs = []; state.activity = [];
  state.modal = null;
}

async function loadWorkspace(id: string): Promise<void> {
  const selected = state.workspaces.find((workspace) => workspace.id === id);
  if (!selected) return;
  state.workspace = selected;
  state.loading = true;
  render();
  const query = '?workspaceId=' + encodeURIComponent(id);
  const results = await Promise.allSettled([
    api<FileRecord[]>('/api/files' + query), api<GalleryItem[]>('/api/gallery' + query), api<Job[]>('/api/jobs' + query),
    api<Activity[]>('/api/activity' + query), api<ShareSummary[]>('/api/workspaces/shares' + query), api<ApiKey[]>('/api/keys'),
  ]);
  state.files = results[0].status === 'fulfilled' ? results[0].value : [];
  state.gallery = results[1].status === 'fulfilled' ? results[1].value : [];
  state.jobs = results[2].status === 'fulfilled' ? results[2].value : [];
  state.activity = results[3].status === 'fulfilled' ? results[3].value : [];
  state.shares = results[4].status === 'fulfilled' ? results[4].value.map((share) => ({ ...share, active: !share.revokedAt && (!share.validUntil || Date.parse(share.validUntil) > Date.now()) })) : [];
  state.keys = results[5].status === 'fulfilled' ? results[5].value : [];
  state.loading = false;
  render();
}

async function enterSession(token: string, principal?: Principal): Promise<void> {
  state.token = token;
  localStorage.setItem('octo_token', token);
  const identity = await api<{ principal: Principal; confirmSecretSet?: boolean }>('/api/me');
  state.principal = principal ?? identity.principal;
  state.confirmSecretSet = Boolean(identity.confirmSecretSet);
  localStorage.setItem('octo_principal', JSON.stringify(state.principal));
  state.workspaces = await api<WorkspaceSummary[]>('/api/workspaces');
  state.workspace = null;
  if (state.workspaces.length) await loadWorkspace(state.workspaces[0]!.id);
  else render();
}

async function bootstrap(): Promise<void> {
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const callbackToken = hash.get('token');
  const authError = hash.get('auth_error');
  if (callbackToken) {
    history.replaceState(null, '', location.pathname + location.search);
    try { await enterSession(callbackToken); } catch { clearSession(); render(); }
    return;
  }
  if (authError) history.replaceState(null, '', location.pathname + location.search);
  try {
    const health = await fetch('/health');
    if (health.ok) state.googleAuthEnabled = Boolean((await health.json()).googleAuthEnabled);
  } catch { state.googleAuthEnabled = false; }
  const saved = localStorage.getItem('octo_token');
  if (saved) {
    try { await enterSession(saved); return; } catch { clearSession(); }
  }
  render();
}

function navButton(view: View, label: string, icon: string): string {
  return '<button class="nav-item' + (state.view === view ? ' is-active' : '') + '" data-view="' + view + '" type="button"><span class="nav-icon" aria-hidden="true">' + icon + '</span><span>' + label + '</span></button>';
}

function fileRows(): string {
  if (!state.files.length) return '<tr><td colspan="5" class="empty-row">No files in this workspace yet.</td></tr>';
  return state.files.map((file) => {
    const status = file.archiveState === 'archived_drive' ? 'Archived' : file.archiveState === 'archiving' || file.archiveState === 'restoring' ? 'Transitioning' : 'Ready';
    const action = file.archiveState === 'archived_drive' ? '<button class="text-button" data-action="restore" data-id="' + esc(file.id) + '">Restore</button>' : '<button class="text-button" data-action="archive" data-id="' + esc(file.id) + '">Archive</button>';
    return '<tr><td><span class="file-cell"><span class="file-mark" aria-hidden="true">↗</span><span><strong>' + esc(file.name) + '</strong><small aria-hidden="true">' + esc(file.mimeType) + '</small></span></span></td><td>' + bytes(file.sizeBytes) + '</td><td>' + status + '</td><td>' + date(file.createdAt) + '</td><td class="row-actions"><button class="text-button" data-action="download" data-id="' + esc(file.id) + '">Download</button>' + action + '<button class="text-button danger" data-action="delete-file" data-id="' + esc(file.id) + '">Remove</button></td></tr>';
  }).join('');
}

function mediaCards(items: GalleryItem[], limit?: number): string {
  const rows = typeof limit === 'number' ? items.slice(0, limit) : items;
  if (!rows.length) return '<div class="empty-panel"><span class="empty-mark">▧</span><strong>No media yet</strong><p>Images and videos added to this workspace appear here.</p></div>';
  return '<div class="media-grid">' + rows.map((item) => '<button class="media-card" data-action="preview" data-id="' + esc(item.id) + '" aria-label="Open ' + esc(item.name) + '"><img src="' + esc(item.thumbnailUrl) + '" alt="' + esc(item.name) + '" loading="lazy"><span class="media-meta"><strong>' + esc(item.name) + '</strong><small>' + bytes(item.sizeBytes) + '</small></span></button>').join('') + '</div>';
}

function activityRows(items: Activity[]): string {
  if (!items.length) return '<div class="empty-panel compact"><strong>No recent activity</strong><p>Workspace events will show here.</p></div>';
  return '<div class="activity-list">' + items.slice(0, 5).map((item) => '<div class="activity-row"><span class="activity-dot"></span><span><strong>' + esc(item.summary) + '</strong><small>' + esc(item.eventType) + '</small></span><time>' + date(item.createdAt) + '</time></div>').join('') + '</div>';
}

function modalMarkup(): string {
  if (!state.modal) return '';
  const close = '<button class="icon-button modal-close" type="button" data-action="close-modal" aria-label="Close dialog">×</button>';
  const shell = (title: string, body: string, footer = '') => '<dialog open class="modal" aria-labelledby="modal-title"><div class="modal-head"><div><p class="eyebrow">OCTO WORKSPACE</p><h2 id="modal-title">' + title + '</h2></div>' + close + '</div><div class="modal-body">' + body + (state.modalError ? '<p class="form-error" role="alert">' + esc(state.modalError) + '</p>' : '') + '</div>' + (footer ? '<div class="modal-foot">' + footer + '</div>' : '') + '</dialog><div class="modal-scrim" data-action="close-modal"></div>';
  if (state.modal === 'workspace') return shell('New Workspace', '<form data-form="workspace"><label>Workspace name<input name="name" required autocomplete="off" placeholder="e.g. Research" /></label><label>Description <span class="optional">Optional</span><textarea name="description" rows="3" placeholder="What belongs in this workspace?"></textarea></label><label>Archive after <span class="optional">Optional</span><select name="retentionDays"><option value="0">Never</option><option value="30">30 days</option><option value="90">90 days</option><option value="180">180 days</option></select></label><button class="button primary" type="submit">Create Workspace</button></form>');
  if (state.modal === 'text-file') return shell('New text file', '<form data-form="text-file"><label>File name<input name="name" required placeholder="notes.txt" /></label><label>Contents<textarea name="content" rows="8" placeholder="Write something useful…"></textarea></label><button class="button primary" type="submit">Save file</button></form>');
  if (state.modal === 'key') return shell('Generate API Key', '<form data-form="key"><label>Key name<input name="name" required placeholder="e.g. Ingest Agent" /></label><label>Scope<select name="scope"><option value="workspace">This workspace</option><option value="account">Account-wide</option></select></label><label>Expires in <span class="optional">Optional</span><select name="expires"><option value="">Never</option><option value="30">30 days</option><option value="90">90 days</option><option value="365">1 year</option></select></label><button class="button primary" type="submit">Generate API Key</button></form>');
  if (state.modal === 'share') return shell('Create share link', '<form data-form="share"><p class="muted">Anyone with this link can view this workspace gallery.</p><label>Expires in<select name="expires"><option value="0">No expiry</option><option value="24">24 hours</option><option value="168">7 days</option><option value="720">30 days</option></select></label><button class="button primary" type="submit">Create link</button></form>');
  if (state.modal === 'workspace-created') return shell('Workspace created', '<p class="muted">Save this workspace key now. It will not be shown again.</p><div class="secret-box"><code>' + esc(state.oneTimeSecret) + '</code><button type="button" class="text-button" data-action="copy-secret">Copy</button></div>', '<button class="button primary" data-action="done-secret" type="button">Done</button>');
  if (state.modal === 'key-created') return shell('New API Key Minted', '<p class="muted">Copy this secret now. It is shown only once.</p><div class="secret-box"><code>' + esc(state.oneTimeSecret) + '</code><button type="button" class="text-button" data-action="copy-secret">Copy</button></div>', '<button class="button primary" data-action="done-secret" type="button">Done</button>');
  if (state.modal === 'share-created') return shell('Copy this link now', '<p class="muted">This read-only link is shown once. Anyone with it can view the shared gallery.</p><div class="secret-box"><code>' + esc(state.shareUrl) + '</code><button type="button" class="text-button" data-action="copy-share">Copy</button></div>', '<button class="button primary" data-action="done-secret" type="button">Done</button>');
  if (state.modal === 'delete-workspace') {
    const setup = state.confirmSecretSet ? '' : '<label>New confirmation secret<input name="newSecret" autocomplete="new-password" type="password" required /></label><button class="button secondary" type="button" data-action="set-secret">Set confirmation secret</button>';
    return shell('Delete ' + esc(state.workspace?.name) + '?', '<p class="muted">This permanently removes the workspace and its catalog.</p><form data-form="delete-workspace">' + setup + '<label>Type ' + esc(state.workspace?.slug) + ' to confirm<input name="slug" required aria-label="Type workspace slug to confirm" /></label><label>Confirmation secret<input name="secret" required type="password" autocomplete="current-password" /></label><button class="button danger-button" type="submit">Delete workspace</button></form>');
  }
  if (state.modal === 'preview' && state.previewItem) return '<dialog open class="modal preview-modal" role="dialog"><button class="icon-button preview-close" data-action="close-modal" aria-label="Close dialog">×</button>' + (state.previewItem.kind === 'video' ? '<video src="' + esc(state.previewItem.fullUrl) + '" controls autoplay></video>' : '<img src="' + esc(state.previewItem.fullUrl) + '" alt="' + esc(state.previewItem.name) + '" />') + '<p>' + esc(state.previewItem.name) + '</p></dialog><div class="modal-scrim" data-action="close-modal"></div>';
  return '';
}

function renderLogin(): void {
  root!.innerHTML = '<main class="login-screen"><section class="login-card"><div class="brand-lockup"><span class="brand-mark">◉</span><span>octo</span></div><p class="eyebrow">WORKSPACE DATA PLATFORM</p><h1>Welcome to Octo</h1><p class="login-copy">A calm home for your workspace data, files, and activity.</p><div class="login-actions">' + (state.googleAuthEnabled ? '<button class="button google-button" data-action="google" type="button"><span class="google-g">G</span>Sign in with Google</button>' : '<button class="button google-button" disabled type="button" aria-label="Google sign-in not configured"><span class="google-g">G</span>Google sign-in not configured</button>') + '<button class="button primary" data-action="guest" type="button">Continue as Guest<span aria-hidden="true">→</span></button></div><p class="login-note">Your workspaces stay separate and scoped to your account.</p></section><div class="login-art" aria-hidden="true"><div class="orb orb-one"></div><div class="orb orb-two"></div><div class="art-grid"></div><div class="art-caption"><span class="live-dot"></span> Your workspace, in one place</div></div></main>';
}

function renderOverview(): string {
  const used = state.files.reduce((sum, file) => sum + (file.sizeBytes || 0), 0);
  const failed = state.jobs.filter((job) => job.state === 'failed').length;
  return '<section class="welcome-panel"><div><p class="eyebrow">' + esc(state.workspace?.role ?? 'Workspace').toUpperCase() + ' WORKSPACE' + (state.principal?.isGuest ? ' · GUEST SANDBOX' : '') + '</p><h2>Workspace overview</h2><p>' + esc(state.workspace?.description || 'Your files, media, and workspace activity in one place.') + '</p></div><div class="welcome-actions"><button class="button primary" data-action="open-upload">Upload files</button><button class="button secondary" data-action="new-text">New text file</button></div></section><div class="metric-grid"><article class="metric-card"><span class="metric-label">Recorded storage</span><strong>' + bytes(used) + '</strong><small>From active file records</small></article><article class="metric-card"><span class="metric-label">Files</span><strong>' + state.files.length + '</strong><small>Catalogued in this workspace</small></article><article class="metric-card"><span class="metric-label">Media</span><strong>' + state.gallery.length + '</strong><small>Images and videos</small></article><article class="metric-card"><span class="metric-label">Failed jobs</span><strong class="' + (failed ? 'metric-warning' : '') + '">' + failed + '</strong><small>Recent operations</small></article></div><div class="content-grid"><section class="panel panel-wide"><div class="panel-head"><div><p class="eyebrow">YOUR DATA</p><h2>File Catalog</h2></div><button class="text-button" data-view="files">View all files →</button></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Size</th><th>Status</th><th>Added</th></tr></thead><tbody>' + (state.files.length ? state.files.slice(0, 5).map((file) => '<tr><td><span class="file-cell"><span class="file-mark" aria-hidden="true">↗</span><span><strong>' + esc(file.name) + '</strong><small aria-hidden="true">' + esc(file.mimeType) + '</small></span></span></td><td>' + bytes(file.sizeBytes) + '</td><td>' + (file.archiveState === 'archived_drive' ? 'Archived' : 'Ready') + '</td><td>' + date(file.createdAt) + '</td></tr>').join('') : '<tr><td colspan="4" class="empty-row">Your first file will show up here.</td></tr>') + '</tbody></table></div></section><section class="panel"><div class="panel-head"><div><p class="eyebrow">WORKSPACE MEDIA</p><h2>Gallery</h2></div><button class="text-button" data-view="gallery">Browse →</button></div>' + mediaCards(state.gallery, 3) + '</section></div><section class="panel activity-panel"><div class="panel-head"><div><p class="eyebrow">LATEST</p><h2>Recent activity</h2></div><button class="text-button" data-view="operations">Operations →</button></div>' + activityRows(state.activity.slice(0, 3)) + '</section>';
}

function renderFiles(): string {
  return '<section class="panel"><div class="panel-head"><div><p class="eyebrow">WORKSPACE CONTENT</p><h2>File Catalog</h2><p class="panel-copy">Upload and manage the files in ' + esc(state.workspace?.name) + '.</p></div><div class="inline-actions"><button class="button secondary" data-action="new-text">New text file</button><button class="button primary" data-action="open-upload">Upload files</button></div></div><div class="table-wrap"><table><thead><tr><th>Name</th><th>Size</th><th>Status</th><th>Added</th><th>Actions</th></tr></thead><tbody>' + fileRows() + '</tbody></table></div></section>';
}

function renderGallery(): string {
  return '<section class="panel"><div class="panel-head"><div><p class="eyebrow">VISUAL LIBRARY</p><h2>Gallery</h2><p class="panel-copy">' + state.gallery.length + ' images and videos in this workspace.</p></div><button class="button primary" data-action="open-upload">Add media</button></div>' + mediaCards(state.gallery) + '</section>';
}

function renderOperations(): string {
  const queued = state.jobs.filter((job) => job.state === 'queued').length;
  const failed = state.jobs.filter((job) => job.state === 'failed').length;
  const jobs = state.jobs.length ? '<div class="table-wrap"><table><thead><tr><th>Job</th><th>State</th><th>Attempts</th><th>Created</th><th></th></tr></thead><tbody>' + state.jobs.map((job) => '<tr><td><strong>' + esc(job.jobType) + '</strong>' + (job.errorSummary ? '<small class="error-detail">' + esc(job.errorSummary) + '</small>' : '') + '</td><td><span class="state-pill state-' + esc(job.state) + '">' + esc(job.state) + '</span></td><td>' + job.attempts + ' / ' + job.maxAttempts + '</td><td>' + when(job.createdAt) + '</td><td>' + (job.state === 'failed' ? '<button class="text-button" data-action="retry" data-id="' + esc(job.id) + '">Retry</button>' : '') + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="empty-panel compact"><strong>No recent jobs</strong><p>File processing jobs will appear here.</p></div>';
  return '<div class="metric-grid metric-grid-three"><article class="metric-card"><span class="metric-label">Queued:</span><strong>' + queued + '</strong><small>Waiting for a worker</small></article><article class="metric-card"><span class="metric-label">Failed:</span><strong class="' + (failed ? 'metric-warning' : '') + '">' + failed + '</strong><small>May need another try</small></article><article class="metric-card"><span class="metric-label">Recent jobs</span><strong>' + state.jobs.length + '</strong><small>Latest workspace records</small></article></div><section class="panel"><div class="panel-head"><div><p class="eyebrow">WORKSPACE QUEUE</p><h2>Operations</h2><p class="panel-copy">Review processing and retry failed work.</p></div><button class="button primary" data-action="run-worker">Run worker pass</button></div>' + jobs + '</section><section class="panel activity-panel"><div class="panel-head"><div><p class="eyebrow">EVENT LOG</p><h2>Recent activity</h2></div></div>' + activityRows(state.activity) + '</section>';
}

function renderAccess(): string {
  const keyRows = state.keys.length ? '<div class="table-wrap"><table><thead><tr><th>Name</th><th>Scope</th><th>Created</th><th>Last used</th><th></th></tr></thead><tbody>' + state.keys.map((key) => '<tr><td><strong>' + esc(key.name) + '</strong><small><code>' + esc(key.prefix) + '…</code></small></td><td>' + (key.isAccountWide ? 'Account-wide' : 'Workspace') + '</td><td>' + date(key.createdAt) + '</td><td>' + date(key.lastUsedAt) + '</td><td><button class="text-button danger" data-action="revoke-key" data-id="' + esc(key.id) + '">Revoke</button></td></tr>').join('') + '</tbody></table></div>' : '<div class="empty-panel compact"><strong>No API keys yet</strong><p>Create one for an application or agent.</p></div>';
  const shareRows = state.shares.length ? '<div class="table-wrap"><table><thead><tr><th>Link</th><th>Permission</th><th>Created</th><th>Visits</th><th></th></tr></thead><tbody>' + state.shares.map((share) => '<tr><td><strong>' + (share.active ? 'Active gallery link' : 'Revoked') + '</strong><small>Expires ' + date(share.validUntil) + '</small></td><td>' + esc(share.permission) + '</td><td>' + date(share.createdAt) + '</td><td>' + share.accessCount + '</td><td>' + (share.active ? '<button class="text-button danger" data-action="revoke-share" data-id="' + esc(share.id) + '">Revoke</button>' : '<span class="muted">Revoked</span>') + '</td></tr>').join('') + '</tbody></table></div>' : '<div class="empty-panel compact"><strong>No share links</strong><p>Create a read-only gallery link for this workspace.</p></div>';
  return '<section class="panel"><div class="panel-head"><div><p class="eyebrow">MACHINE ACCESS</p><h2>API keys</h2><p class="panel-copy">Keys are shown once when created.</p></div><button class="button primary" data-action="new-key">Generate API Key</button></div>' + keyRows + '</section><section class="panel"><div class="panel-head"><div><p class="eyebrow">SHARED CONTENT</p><h2>Share links</h2><p class="panel-copy">Read-only access to this workspace gallery.</p></div><button class="button secondary" data-action="new-share">Create link</button></div>' + shareRows + '</section><section class="panel settings-panel"><div class="panel-head"><div><p class="eyebrow">WORKSPACE</p><h2>' + esc(state.workspace?.name) + '</h2><p class="panel-copy">' + esc(state.workspace?.description || 'No description') + '</p></div><span class="role-tag">' + esc(state.workspace?.role) + '</span></div><dl class="detail-list"><div><dt>Workspace slug</dt><dd>' + esc(state.workspace?.slug) + '</dd></div><div><dt>File retention</dt><dd>' + (state.workspace?.retentionDays ? state.workspace.retentionDays + ' days' : 'No automatic archive') + '</dd></div><div><dt>Confirmation secret</dt><dd>' + (state.confirmSecretSet ? 'Configured' : 'Not configured') + '</dd></div></dl><button class="button danger-button" data-action="delete-workspace">Delete Workspace</button></section>';
}

function renderApp(): void {
  const labels: Record<View, string> = { overview: 'Overview', files: 'Files', gallery: 'Gallery', operations: 'Operations', access: 'Access' };
  const body = state.view === 'overview' ? renderOverview() : state.view === 'files' ? renderFiles() : state.view === 'gallery' ? renderGallery() : state.view === 'operations' ? renderOperations() : renderAccess();
  const select = state.workspaces.map((workspace) => '<option value="' + esc(workspace.id) + '" ' + (workspace.id === state.workspace?.id ? 'selected' : '') + '>' + esc(workspace.name) + '</option>').join('');
  const toast = state.notice ? '<div class="toast" role="status">' + esc(state.notice) + '</div>' : '';
  const workspaceName = state.workspace?.name || 'No Authorized Workspaces';
  const guestSuffix = state.principal?.isGuest && !workspaceName.endsWith(' (Guest)') ? ' (Guest)' : '';
  root!.innerHTML = '<div class="app-shell" data-theme="' + state.theme + '"><aside class="sidebar"><a class="brand-lockup" href="/" aria-label="Octo home"><span class="brand-mark">◉</span><span>octo</span></a><div class="workspace-label">WORKSPACE</div><label class="sr-only" for="workspace-select">Select workspace</label><select id="workspace-select" class="workspace-picker" ' + (state.workspaces.length ? '' : 'disabled') + '>' + (select || '<option>No workspaces</option>') + '</select><nav class="main-nav" aria-label="Workspace navigation">' + navButton('overview', 'Overview', '◫') + navButton('files', 'Files', '⌑') + navButton('gallery', 'Gallery', '▧') + navButton('operations', 'Operations', '⌁') + navButton('access', 'Access', '⌑') + '</nav><div class="sidebar-spacer"></div><div class="sidebar-note"><span class="live-dot"></span><span>Workspace data is live</span></div><div class="profile"><span class="avatar">' + esc((state.principal?.displayName || state.principal?.email || 'O').slice(0, 1).toUpperCase()) + '</span><span class="profile-copy"><strong>' + esc(state.principal?.displayName || (state.principal?.isGuest ? 'Personal (Guest)' : state.principal?.email)) + '</strong><small>' + (state.principal?.isPlatformOwner ? 'Platform owner' : state.principal?.isGuest ? 'Guest session' : 'Workspace member') + '</small></span><button class="icon-button signout" type="button" data-action="sign-out" aria-label="Sign out" title="Sign out">↗</button></div></aside><main class="main-area"><header class="topbar"><div class="breadcrumbs"><span>Workspace Control Dashboard</span><span class="crumb-divider">/</span><strong>' + labels[state.view] + '</strong></div><div class="topbar-actions"><span class="workspace-chip">' + esc(state.workspace?.role ?? 'No workspace') + '</span><button class="icon-button theme-toggle" type="button" data-action="theme" aria-label="Switch color theme" title="Switch color theme">' + (state.theme === 'midnight' ? '☼' : '◐') + '</button><button class="button quiet small" type="button" data-action="sign-out">Sign out</button></div></header><div class="page-wrap"><div class="page-heading"><div><p class="eyebrow">' + (state.principal?.isGuest ? 'PERSONAL WORKSPACE' : 'OCTO / ' + labels[state.view].toUpperCase()) + '</p><h1>' + esc(workspaceName + guestSuffix) + '</h1><p class="page-subtitle">' + (state.view === 'overview' ? 'Everything important in this workspace, at a glance.' : state.view === 'files' ? 'Find and manage workspace files.' : state.view === 'gallery' ? 'A visual view of your workspace media.' : state.view === 'operations' ? 'Recent jobs and activity for this workspace.' : 'Manage workspace credentials and shares.') + '</p></div><div class="page-actions"><button class="button secondary" data-action="new-workspace">+ New Workspace</button></div></div>' + (state.loading ? '<div class="loading-bar" aria-label="Loading workspace"></div>' : '') + body + '<input class="sr-only" type="file" id="binary-upload" aria-label="Upload file" multiple>' + '</div></main>' + toast + modalMarkup() + '</div>';
  document.documentElement.dataset.octoSystem = state.theme;
}

function render(): void {
  if (location.pathname.match(/^\/share\/.+/)) { void renderPublicShare(); return; }
  if (!state.token || !state.principal) renderLogin(); else renderApp();
}

function notify(message: string): void {
  state.notice = message;
  render();
  window.setTimeout(() => { if (state.notice === message) { state.notice = ''; render(); } }, 3200);
}

function openModal(modal: Modal): void { state.modal = modal; state.modalError = ''; render(); }
function closeModal(): void { state.modal = null; state.modalError = ''; state.previewItem = null; render(); }

async function uploadFile(file: File): Promise<void> {
  if (!state.workspace) return;
  const data = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < data.length; offset += 0x8000) binary += String.fromCharCode(...Array.from(data.subarray(offset, offset + 0x8000)));
  await api('/api/files/upload', { method: 'POST', body: JSON.stringify({ workspaceId: wsId(), name: file.name, mimeType: file.type || 'application/octet-stream', data: btoa(binary), dataEncoding: 'base64' }) });
  await loadWorkspace(wsId());
  notify('File uploaded');
}

async function downloadFile(id: string): Promise<void> {
  const blob = await api<Blob>('/api/files/content?' + new URLSearchParams({ workspaceId: wsId(), fileId: id }));
  const file = state.files.find((item) => item.id === id);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = file?.name ?? id; link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function renderPublicShare(): Promise<void> {
  const token = decodeURIComponent(location.pathname.split('/').slice(2).join('/'));
  root!.innerHTML = '<main class="public-shell"><div class="public-head"><a class="brand-lockup" href="/"><span class="brand-mark">◉</span><span>octo</span></a><span class="public-badge">Shared gallery</span></div><section class="public-content"><p class="eyebrow">READ ONLY</p><h1>🐙 Shared Album</h1><p class="muted">Read-only view of a single shared album.</p><div class="public-state" id="share-state">Loading shared album…</div></section></main>';
  try {
    const data = await fetch('/api/public/shares/' + encodeURIComponent(token)).then(async (res) => { if (!res.ok) throw new Error('unavailable'); return res.json(); });
    const share = data.share as { permission: string; validUntil: string | null };
    const items = data.items as GalleryItem[];
    const container = $('#share-state');
    if (container) container.innerHTML = '<div class="share-meta"><span>Permission: ' + esc(share.permission) + '</span><span>' + (share.validUntil ? 'Expires ' + date(share.validUntil) : 'No expiry (revocable)') + '</span></div>' + mediaCards(items);
  } catch {
    const container = $('#share-state');
    if (container) container.innerHTML = '<div class="empty-panel"><strong>This link is not available</strong><p>It may have been revoked, expired, or never existed.</p></div>';
  }
}

root.addEventListener('change', async (event) => {
  const target = event.target;
  if (target instanceof HTMLSelectElement && target.id === 'workspace-select') await loadWorkspace(target.value);
  if (target instanceof HTMLInputElement && target.id === 'binary-upload' && target.files) {
    for (const file of Array.from(target.files)) {
      try { await uploadFile(file); } catch (error) { notify(error instanceof Error ? error.message : 'Upload failed'); }
    }
    target.value = '';
  }
});

root.addEventListener('click', async (event) => {
  const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-action], [data-view]') : null;
  if (!target) return;
  const view = target.dataset.view as View | undefined;
  if (view) { state.view = view; render(); return; }
  const action = target.dataset.action;
  const id = target.dataset.id ?? '';
  try {
    if (action === 'guest') {
      state.loading = true; render();
      const result = await api<{ principal: Principal; sessionToken: string; workspace: WorkspaceSummary }>('/api/auth/guest', { method: 'POST', body: JSON.stringify({ displayName: 'Guest User' }) });
      await enterSession(result.sessionToken, result.principal);
    } else if (action === 'google') location.href = '/api/auth/google';
    else if (action === 'sign-out') { clearSession(); render(); }
    else if (action === 'theme') { state.theme = state.theme === 'midnight' ? 'paper' : 'midnight'; localStorage.setItem('octo-design-system', state.theme); render(); }
    else if (action === 'new-workspace') openModal('workspace');
    else if (action === 'new-text') openModal('text-file');
    else if (action === 'open-upload') $('#binary-upload')?.click();
    else if (action === 'new-key') openModal('key');
    else if (action === 'new-share') openModal('share');
    else if (action === 'delete-workspace') openModal('delete-workspace');
    else if (action === 'close-modal') closeModal();
    else if (action === 'done-secret') { state.oneTimeSecret = ''; state.shareUrl = ''; closeModal(); }
    else if (action === 'copy-secret') await navigator.clipboard.writeText(state.oneTimeSecret);
    else if (action === 'copy-share') await navigator.clipboard.writeText(state.shareUrl);
    else if (action === 'download') await downloadFile(id);
    else if (action === 'archive' || action === 'restore') { await api('/api/files/' + encodeURIComponent(id) + '/' + action + '?workspaceId=' + encodeURIComponent(wsId()), { method: 'POST' }); await loadWorkspace(wsId()); }
    else if (action === 'delete-file') { if (confirm('Remove this file from the workspace?')) { await api('/api/files/' + encodeURIComponent(id) + '?workspaceId=' + encodeURIComponent(wsId()), { method: 'DELETE' }); await loadWorkspace(wsId()); } }
    else if (action === 'preview') { state.previewItem = state.gallery.find((item) => item.id === id) ?? null; openModal('preview'); }
    else if (action === 'retry') { await api('/api/jobs/' + encodeURIComponent(id) + '/retry?workspaceId=' + encodeURIComponent(wsId()), { method: 'POST' }); await loadWorkspace(wsId()); }
    else if (action === 'run-worker') { await api('/api/jobs/run?workspaceId=' + encodeURIComponent(wsId()), { method: 'POST' }); await loadWorkspace(wsId()); }
    else if (action === 'revoke-key') { await api('/api/keys/' + encodeURIComponent(id), { method: 'DELETE' }); state.keys = await api<ApiKey[]>('/api/keys'); render(); }
    else if (action === 'revoke-share') { await api('/api/shares/' + encodeURIComponent(id) + '?workspaceId=' + encodeURIComponent(wsId()), { method: 'DELETE' }); await loadWorkspace(wsId()); }
    else if (action === 'set-secret') {
      const secret = $('input[name="newSecret"]') as HTMLInputElement | null;
      if (!secret?.value) throw new Error('Enter a new confirmation secret.');
      await api('/api/me/confirm-secret', { method: 'POST', body: JSON.stringify({ secret: secret.value }) });
      state.confirmSecretSet = true; render();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Action failed';
    if (state.modal) { state.modalError = message; render(); } else notify(message);
  }
});

root.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.dataset.form) return;
  event.preventDefault();
  const data = new FormData(form);
  try {
    if (form.dataset.form === 'workspace') {
      const result = await api<{ workspace: WorkspaceSummary; rawSecret: string }>('/api/workspaces', { method: 'POST', body: JSON.stringify({ name: String(data.get('name') ?? '').trim(), description: String(data.get('description') ?? '').trim() || undefined, retentionDays: Number(data.get('retentionDays')) || null }) });
      state.workspaces = await api<WorkspaceSummary[]>('/api/workspaces');
      state.oneTimeSecret = result.rawSecret; state.oneTimeLabel = result.workspace.name; state.modal = 'workspace-created'; render();
    } else if (form.dataset.form === 'text-file') {
      await api('/api/files/upload', { method: 'POST', body: JSON.stringify({ workspaceId: wsId(), name: String(data.get('name') ?? '').trim(), mimeType: 'text/plain', data: String(data.get('content') ?? ''), dataEncoding: 'utf8' }) });
      closeModal(); await loadWorkspace(wsId());
    } else if (form.dataset.form === 'key') {
      const result = await api<{ apiKey: ApiKey; rawSecret: string }>('/api/keys', { method: 'POST', body: JSON.stringify({ name: String(data.get('name') ?? '').trim(), workspaceId: data.get('scope') === 'account' ? null : wsId(), expiresInDays: Number(data.get('expires')) || undefined }) });
      state.keys = [result.apiKey, ...state.keys]; state.oneTimeSecret = result.rawSecret; state.modal = 'key-created'; render();
    } else if (form.dataset.form === 'share') {
      const expiry = Number(data.get('expires')) || null;
      const result = await api<{ rawToken: string; share: Omit<ShareSummary, 'active'> }>('/api/workspaces/shares', { method: 'POST', body: JSON.stringify({ workspaceId: wsId(), resourceType: 'gallery', permission: 'read', expiresInHours: expiry }) });
      state.shareUrl = location.origin + '/share/' + result.rawToken;
      state.shares = [{ ...result.share, active: true }, ...state.shares];
      state.modal = 'share-created'; render();
    } else if (form.dataset.form === 'delete-workspace') {
      await api('/api/workspaces/' + encodeURIComponent(wsId()), { method: 'DELETE', body: JSON.stringify({ confirmSecret: String(data.get('secret') ?? ''), confirmSlug: String(data.get('slug') ?? '') }) });
      state.workspaces = await api<WorkspaceSummary[]>('/api/workspaces'); state.modal = null; state.workspace = null;
      if (state.workspaces.length) await loadWorkspace(state.workspaces[0]!.id); else render();
    }
  } catch (error) {
    state.modalError = error instanceof Error ? error.message : 'Could not complete this action.';
    render();
  }
});

void bootstrap();
