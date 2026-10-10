import { useEffect, useRef, useState } from 'react';
import { useOcto, type View } from '@/lib/octo';
import { useSession } from '@/lib/session';
import { useTheme } from '@/lib/theme';
import { useWorkspace } from '@/lib/workspace';
import { uploadFile } from '@/lib/files';
import { showError, showSuccess } from '@/utils/toast';
import { WorkspaceNotice } from '@/components/Notices';
import { Toast } from '@/components/Toast';
import {
  DeleteWorkspaceModal,
  KeyCreatedModal,
  KeyModal,
  MfaEnrollModal,
  MfaRecoveryModal,
  PreviewModal,
  ShareCreatedModal,
  ShareModal,
  TextFileModal,
  WorkspaceModal,
} from '@/components/Modals';
import Overview from '@/pages/Overview';
import Files from '@/pages/Files';
import Gallery from '@/pages/Gallery';
import Operations from '@/pages/Operations';
import Access from '@/pages/Access';

const VIEW_LABELS: Record<View, string> = {
  overview: 'Overview',
  files: 'Files',
  gallery: 'Gallery',
  operations: 'Operations',
  access: 'Access',
};

const SUBTITLES: Record<View, string> = {
  overview: 'Everything important in this workspace, at a glance.',
  files: 'Find and manage workspace files.',
  gallery: 'A visual view of your workspace media.',
  operations: 'Recent jobs and activity for this workspace.',
  access: 'Manage workspace credentials and shares.',
};

function NavButton({ view, label, icon }: { view: View; label: string; icon: string }) {
  const { view: active, setView } = useOcto();
  return (
    <button
      className={`nav-item${active === view ? ' is-active' : ''}`}
      data-view={view}
      type="button"
      onClick={() => setView(view)}
    >
      <span className="nav-icon" aria-hidden="true">
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

export default function Shell() {
  const { view, openModal, refreshConfirmCode, modal } = useOcto();
  const { principal, signOut } = useSession();
  const { theme, toggle } = useTheme();
  const { workspaces, workspace, selectWorkspace, loadError, loading, reload } = useWorkspace();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  // The inline Access form carries a live confirmation code; draw one whenever
  // that view is opened.
  useEffect(() => {
    if (view === 'access') void refreshConfirmCode();
  }, [view, refreshConfirmCode]);

  const onFiles = async (files: FileList | null) => {
    if (!files || !workspace) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        try {
          await uploadFile(workspace.id, file);
        } catch (error) {
          showError(error instanceof Error ? error.message : 'Upload failed');
        }
      }
      await reload();
      showSuccess('File uploaded');
    } finally {
      setUploading(false);
    }
  };

  const workspaceName = workspace?.name || 'No Authorized Workspaces';
  const guestSuffix = principal?.isGuest && !workspaceName.endsWith(' (Guest)') ? ' (Guest)' : '';
  const profileName =
    principal?.displayName || (principal?.isGuest ? 'Personal (Guest)' : principal?.email) || '';

  const body =
    view === 'overview' ? (
      <Overview />
    ) : view === 'files' ? (
      <Files />
    ) : view === 'gallery' ? (
      <Gallery />
    ) : view === 'operations' ? (
      <Operations />
    ) : (
      <Access />
    );

  return (
    <div className="app-shell" data-theme={theme}>
      <aside className="sidebar">
        <a className="brand-lockup" href="/" aria-label="Octo home">
          <span className="brand-mark">◉</span>
          <span>octo</span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <label className="sr-only" htmlFor="workspace-select">
          Select workspace
        </label>
        <select
          id="workspace-select"
          className="workspace-picker"
          data-testid="workspace-picker"
          disabled={!workspaces.length}
          value={workspace?.id ?? ''}
          onChange={(event) => void selectWorkspace(event.target.value)}
        >
          {workspaces.length ? (
            workspaces.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))
          ) : (
            <option>No workspaces</option>
          )}
        </select>
        <nav className="main-nav" aria-label="Workspace navigation" data-testid="app-nav">
          <NavButton view="overview" label="Overview" icon="◫" />
          <NavButton view="files" label="Files" icon="⌑" />
          <NavButton view="gallery" label="Gallery" icon="▧" />
          <NavButton view="operations" label="Operations" icon="⌁" />
          <NavButton view="access" label="Access" icon="⌑" />
        </nav>
        <div className="sidebar-spacer" />
        <div className="sidebar-note">
          <span className="live-dot" />
          <span>Workspace data is live</span>
        </div>
        <div className="profile">
          <span className="avatar">{(profileName || 'O').slice(0, 1).toUpperCase()}</span>
          <span className="profile-copy">
            <strong>{profileName}</strong>
            <small>
              {principal?.isPlatformOwner ? 'Platform owner' : principal?.isGuest ? 'Guest session' : 'Workspace member'}
            </small>
          </span>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace Control Dashboard</span>
            <span className="crumb-divider">/</span>
            <strong>{VIEW_LABELS[view]}</strong>
          </div>
          <div className="topbar-actions">
            <span className="workspace-chip">{workspace?.role ?? 'No workspace'}</span>
            <button
              className="icon-button theme-toggle"
              type="button"
              data-action="theme"
              aria-label="Switch color theme"
              title="Switch color theme"
              onClick={toggle}
            >
              {theme === 'dark' ? '☼' : '◐'}
            </button>
            <button className="button quiet small" type="button" data-action="sign-out" onClick={signOut}>
              Sign out
            </button>
          </div>
        </header>
        <div className="page-wrap">
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {principal?.isGuest ? 'PERSONAL WORKSPACE' : `OCTO / ${VIEW_LABELS[view].toUpperCase()}`}
              </p>
              <h1>{`${workspaceName}${guestSuffix}`}</h1>
              <p className="page-subtitle">{SUBTITLES[view]}</p>
            </div>
            <div className="page-actions">
              <button
                className="button secondary"
                type="button"
                data-action="new-workspace"
                onClick={async () => {
                  await refreshConfirmCode();
                  openModal('workspace');
                }}
              >
                + New Workspace
              </button>
            </div>
          </div>
          {loadError ? (
            <div className="load-error" role="alert">
              {loadError}
            </div>
          ) : null}
          <WorkspaceNotice />
          {loading || uploading ? <div className="loading-bar" aria-label="Loading workspace" /> : null}
          {body}
          <input
            className="sr-only"
            type="file"
            id="binary-upload"
            aria-label="Upload file"
            multiple
            ref={fileInput}
            onChange={(event) => {
              void onFiles(event.target.files);
              event.target.value = '';
            }}
          />
        </div>
      </main>
      <Toast />
      {modal === 'workspace' ? <WorkspaceModal /> : null}
      {modal === 'text-file' ? <TextFileModal /> : null}
      {modal === 'key' ? <KeyModal /> : null}
      {modal === 'share' ? <ShareModal /> : null}
      {modal === 'key-created' ? <KeyCreatedModal /> : null}
      {modal === 'share-created' ? <ShareCreatedModal /> : null}
      {modal === 'delete-workspace' ? <DeleteWorkspaceModal /> : null}
      {modal === 'mfa-enroll' ? <MfaEnrollModal /> : null}
      {modal === 'mfa-recovery' ? <MfaRecoveryModal /> : null}
      {modal === 'preview' ? <PreviewModal /> : null}
      <UploadTrigger input={fileInput} />
    </div>
  );
}

/** Lets any view open the one upload input the shell owns. */
function UploadTrigger({ input }: { input: React.RefObject<HTMLInputElement | null> }) {
  useEffect(() => {
    const handler = () => input.current?.click();
    window.addEventListener('octo-open-upload', handler);
    return () => window.removeEventListener('octo-open-upload', handler);
  }, [input]);
  return null;
}
