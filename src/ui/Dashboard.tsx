import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  CssBaseline,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  ThemeProvider,
} from '@mui/material';
import { Principal, WorkspaceSummary } from '../types/auth';
import { WorkspaceContext } from '../auth/workspace-service';
import { FileRecord } from '../storage/file-service';
import { ApiKey } from '../api/keys';
import { ShareSummary } from '../media/share-service';
import { OperationsActivity, OperationsJob, OperationsPage } from './OperationsPage';
import { GalleryItem } from '../media/gallery-service';
import { Gallery } from './Gallery';
import { KeyManager, CreateKeyOptions } from './KeyManager';
import { createOctoTheme, OctoDesignSystemId } from './theme';
import './dashboard.css';

export interface DashboardProps {
  principal: Principal | null;
  workspaces: WorkspaceSummary[];
  activeContext: WorkspaceContext | null;
  files?: FileRecord[];
  galleryItems?: GalleryItem[];
  apiKeys?: ApiKey[];
  onSignInWithGoogle: () => void;
  onSignInAsGuest?: () => void;
  googleAuthEnabled?: boolean;
  onSignOut: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onUploadFile?: (name: string, mimeType: string, content: string) => Promise<void>;
  onUploadBinaryFile?: (file: File) => Promise<void>;
  onDownloadFile?: (fileId: string) => Promise<void>;
  onDeleteFile?: (fileId: string) => Promise<void>;
  onArchiveFile?: (fileId: string) => Promise<void>;
  onRestoreFile?: (fileId: string) => Promise<void>;
  onCreateApiKey?: (
    name: string,
    isAccountWide: boolean,
    options?: CreateKeyOptions
  ) => Promise<{ rawSecret: string }>;
  onRevokeApiKey?: (keyId: string) => Promise<void>;
  onCreateWorkspace?: (input: {
    name: string;
    description?: string;
    retentionDays?: number | null;
  }) => Promise<{ workspace: WorkspaceSummary; rawSecret: string }>;
  onDeleteWorkspace?: (
    workspaceId: string,
    confirmSecret: string,
    confirmSlug: string
  ) => Promise<void>;
  onSetConfirmSecret?: (secret: string, currentSecret?: string) => Promise<void>;
  confirmSecretSet?: boolean;
  shares?: ShareSummary[];
  jobs?: OperationsJob[];
  activity?: OperationsActivity[];
  onRetryJob?: (jobId: string) => void;
  onRunWorker?: () => void;
  onCreateShare?: (expiresInHours: number | null) => Promise<{ rawToken: string }>;
  onRevokeShare?: (shareId: string) => Promise<void>;
  isLoading?: boolean;
}

type DashboardView = 'overview' | 'files' | 'gallery' | 'operations' | 'access';

const VIEW_LABELS: Record<DashboardView, string> = {
  overview: 'Overview',
  files: 'Files',
  gallery: 'Gallery',
  operations: 'Operations',
  access: 'Access',
};

const NAV_ITEMS: Array<{ id: DashboardView; icon: IconName }> = [
  { id: 'overview', icon: 'overview' },
  { id: 'files', icon: 'files' },
  { id: 'gallery', icon: 'gallery' },
  { id: 'operations', icon: 'operations' },
  { id: 'access', icon: 'access' },
];

type IconName = 'overview' | 'files' | 'gallery' | 'operations' | 'access' | 'chevron' | 'sun' | 'moon' | 'upload' | 'plus' | 'arrow' | 'alert' | 'document' | 'clock' | 'signout' | 'close';

const ICON_PATHS: Record<IconName, React.ReactNode> = {
  overview: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="4" rx="1.5" /><rect x="13.5" y="10.5" width="7" height="10" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  files: <><path d="M3.5 7.5h6l2 2h9v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /><path d="M3.5 7.5v-2a2 2 0 0 1 2-2h3l2 2h4" /></>,
  gallery: <><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><circle cx="9" cy="9" r="1.5" /><path d="m20.5 15-5-5L6 20.5" /></>,
  operations: <><path d="M4 18.5h16" /><path d="M6 15V9M12 15V4M18 15v-4" /><circle cx="6" cy="7" r="1.5" /><circle cx="12" cy="17.5" r="1.5" /><circle cx="18" cy="9" r="1.5" /></>,
  access: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3" /><circle cx="12" cy="15.5" r="1" /><path d="M12 16.5v2" /></>,
  chevron: <path d="m7 10 5 5 5-5" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2.5 12h2m15 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  moon: <path d="M20.2 15.7A8.5 8.5 0 0 1 8.3 3.8 8.5 8.5 0 1 0 20.2 15.7Z" />,
  upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M4 16.5v2A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5v-2" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  alert: <><path d="M12 3.5 2.8 20h18.4L12 3.5Z" /><path d="M12 9v4.5M12 17h.01" /></>,
  document: <><path d="M7 3.5h7l4 4V20a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 20V5a1.5 1.5 0 0 1 1-1.5Z" /><path d="M14 3.5V8h4M9 12h6M9 16h6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  signout: <><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" /><path d="M14 16l4-4-4-4M18 12H9" /></>,
  close: <><path d="m6 6 12 12M18 6 6 18" /></>,
};

function Icon({ name, size = 17 }: { name: IconName; size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

function Brand() {
  return (
    <div className="octo-brand">
      <span className="octo-brand__mark">
        <svg aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none">
          <path d="M12 4.2c-3.5 0-6.4 2.6-6.4 5.8 0 2.1 1.2 3.9 3.1 4.9l-1.4 4.3 3.2-2.4h3l3.2 2.4-1.4-4.3c1.9-1 3.1-2.8 3.1-4.9 0-3.2-2.9-5.8-6.4-5.8Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <circle cx="9.5" cy="9.5" r=".65" fill="currentColor" />
          <circle cx="14.5" cy="9.5" r=".65" fill="currentColor" />
          <path d="M8.8 15.1 5.2 17.2M15.2 15.1l3.6 2.1M7.9 12.9l-3.1 1.2M16.1 12.9l3.1 1.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
      <span>octo</span>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function FileKind({ mimeType }: { mimeType: string }) {
  return <span className="octo-file-icon"><Icon name="document" size={17} /></span>;
}

function EmptyState({ title, copy, action }: { title: string; copy: string; action?: React.ReactNode }) {
  return (
    <div className="octo-empty">
      <span className="octo-empty__mark"><Icon name="files" size={19} /></span>
      <h3 className="octo-empty__title">{title}</h3>
      <p className="octo-empty__copy">{copy}</p>
      {action}
    </div>
  );
}

export const Dashboard: React.FC<DashboardProps> = ({
  principal,
  workspaces,
  activeContext,
  files = [],
  galleryItems = [],
  apiKeys = [],
  onSignInWithGoogle,
  onSignInAsGuest,
  googleAuthEnabled = false,
  onSignOut,
  onSelectWorkspace,
  onUploadFile,
  onUploadBinaryFile,
  onDownloadFile,
  onDeleteFile,
  onArchiveFile,
  onRestoreFile,
  onCreateApiKey,
  onRevokeApiKey,
  onCreateWorkspace,
  onDeleteWorkspace,
  onSetConfirmSecret,
  confirmSecretSet = false,
  shares = [],
  jobs = [],
  activity = [],
  onRetryJob,
  onRunWorker,
  onCreateShare,
  onRevokeShare,
  isLoading = false,
}) => {
  const [selectedWsId, setSelectedWsId] = useState(activeContext?.workspace.id ?? workspaces[0]?.id ?? '');
  const [view, setView] = useState<DashboardView>('overview');
  const [designSystem, setDesignSystem] = useState<OctoDesignSystemId>(() => {
    if (typeof window === 'undefined') return 'midnight';
    return window.localStorage.getItem('octo-design-system') === 'paper' ? 'paper' : 'midnight';
  });
  const [createdShareUrl, setCreatedShareUrl] = useState<string | null>(null);
  const [shareExpiry, setShareExpiry] = useState<number>(0);
  const [shareError, setShareError] = useState<string | null>(null);
  const [isCreateWsOpen, setIsCreateWsOpen] = useState(false);
  const [newWsName, setNewWsName] = useState('');
  const [newWsDescription, setNewWsDescription] = useState('');
  const [newWsRetention, setNewWsRetention] = useState<number>(0);
  const [createdWsSecret, setCreatedWsSecret] = useState<{ name: string; secret: string } | null>(null);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [isDeleteWsOpen, setIsDeleteWsOpen] = useState(false);
  const [deleteSecret, setDeleteSecret] = useState('');
  const [deleteSlug, setDeleteSlug] = useState('');
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [setupSecret, setSetupSecret] = useState('');
  const [setupCurrentSecret, setSetupCurrentSecret] = useState('');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadFileContent, setUploadFileContent] = useState('');
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const binaryInputRef = useRef<HTMLInputElement>(null);
  const theme = useMemo(() => createOctoTheme(designSystem), [designSystem]);

  useEffect(() => {
    if (activeContext?.workspace.id) setSelectedWsId(activeContext.workspace.id);
  }, [activeContext?.workspace.id]);

  useEffect(() => {
    document.documentElement.dataset.octoSystem = designSystem;
    window.localStorage.setItem('octo-design-system', designSystem);
  }, [designSystem]);

  const runFileAction = async (action: () => Promise<void>, fallback: string) => {
    setFileActionError(null);
    try {
      await action();
    } catch (error) {
      setFileActionError(error instanceof Error ? error.message : fallback);
    }
  };

  const handleWorkspaceChange = (workspaceId: string) => {
    setSelectedWsId(workspaceId);
    onSelectWorkspace(workspaceId);
  };

  const handleCreateShare = async () => {
    if (!onCreateShare) return;
    setShareError(null);
    try {
      const result = await onCreateShare(shareExpiry > 0 ? shareExpiry : null);
      setCreatedShareUrl(window.location.origin + '/share/' + result.rawToken);
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'Could not create this share link.');
    }
  };

  const handleCreateWorkspace = async () => {
    if (!newWsName.trim() || !onCreateWorkspace) return;
    setWorkspaceError(null);
    try {
      const result = await onCreateWorkspace({
        name: newWsName.trim(),
        description: newWsDescription.trim() || undefined,
        retentionDays: newWsRetention > 0 ? newWsRetention : null,
      });
      setCreatedWsSecret({ name: result.workspace.name, secret: result.rawSecret });
      setNewWsName('');
      setNewWsDescription('');
      setNewWsRetention(0);
      setIsCreateWsOpen(false);
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : 'Could not create the workspace.');
    }
  };

  const handleDeleteWorkspace = async () => {
    if (!activeContext || !onDeleteWorkspace) return;
    setDeleteError(null);
    try {
      await onDeleteWorkspace(activeContext.workspace.id, deleteSecret, deleteSlug);
      setIsDeleteWsOpen(false);
      setDeleteSecret('');
      setDeleteSlug('');
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Could not delete the workspace.');
    }
  };

  const handleSetConfirmSecret = async () => {
    if (!onSetConfirmSecret) return;
    setSetupError(null);
    try {
      await onSetConfirmSecret(setupSecret, setupCurrentSecret || undefined);
      setSetupSecret('');
      setSetupCurrentSecret('');
    } catch (error) {
      setSetupError(error instanceof Error ? error.message : 'Could not update the confirmation secret.');
    }
  };

  const handleUpload = async () => {
    if (!uploadFileName.trim() || !onUploadFile) return;
    setFileActionError(null);
    setIsUploading(true);
    try {
      await onUploadFile(uploadFileName.trim(), 'text/plain', uploadFileContent);
      setUploadFileName('');
      setUploadFileContent('');
      setIsUploadDialogOpen(false);
    } catch (error) {
      setFileActionError(error instanceof Error ? error.message : 'File upload failed.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleBinaryFile = async (file?: File) => {
    if (!file || !onUploadBinaryFile) return;
    setIsUploading(true);
    await runFileAction(() => onUploadBinaryFile(file), 'File upload failed.');
    setIsUploading(false);
  };

  const activeWorkspaceName = activeContext?.workspace.name ?? 'Workspace';
  const failedJobs = jobs.filter((job) => job.state === 'failed');
  const pageSubtitle: Record<DashboardView, string> = {
    overview: 'A clear view of what is in this workspace and what needs your attention.',
    files: 'Find, add, and manage the files that belong to this workspace.',
    gallery: 'Browse the images and video stored in this workspace.',
    operations: 'Review background work and resolve jobs that need another try.',
    access: 'Manage the people and machine credentials that can use this workspace.',
  };

  const uploadActions = (
    <>
      {onUploadBinaryFile && (
        <Button
          className="octo-button"
          variant="contained"
          onClick={() => binaryInputRef.current?.click()}
          disabled={isUploading || !activeContext?.capabilities.canUploadFiles}
          startIcon={<Icon name="upload" size={15} />}
        >
          Upload files
        </Button>
      )}
      {onUploadFile && activeContext?.capabilities.canUploadFiles && (
        <Button className="octo-button octo-button--quiet" variant="outlined" onClick={() => setIsUploadDialogOpen(true)}>
          New text file
        </Button>
      )}
    </>
  );

  const renderOverview = () => {
    const recentFiles = files.slice(0, 5);
    const recentMedia = galleryItems.slice(0, 3);
    const latestActivity = activity.slice(0, 3);

    return (
      <>
        <section className="octo-overview-hero">
          <div className="octo-overview-hero__content">
            <div className="octo-overview-hero__meta">
              <span className="octo-status-dot" />
              <span>{activeContext?.role ?? 'Workspace'} workspace</span>
              {principal?.isGuest && <span>Guest session</span>}
            </div>
            <h1 className="octo-overview-hero__title">{activeWorkspaceName}</h1>
            <p className="octo-overview-hero__description">
              {activeContext?.workspace.description || 'Your files and workspace activity, together in one place.'}
            </p>
            <div className="octo-overview-hero__actions">
              {uploadActions}
              <Button className="octo-button octo-button--quiet" variant="outlined" onClick={() => setView('files')} endIcon={<Icon name="arrow" size={15} />}>
                Browse files
              </Button>
            </div>
          </div>
        </section>

        {failedJobs.length > 0 && (
          <section className="octo-access-block">
            <div className="octo-attention">
              <span className="octo-attention__icon"><Icon name="alert" size={17} /></span>
              <div style={{ flex: 1 }}>
                <p className="octo-attention__title">
                  {failedJobs.length} {failedJobs.length === 1 ? 'job needs' : 'jobs need'} attention
                </p>
                <p className="octo-attention__copy">
                  {failedJobs[0]?.errorSummary || 'A background job failed and can be reviewed in Operations.'}
                </p>
              </div>
              <Button className="octo-button octo-button--quiet" variant="outlined" onClick={() => setView('operations')}>
                Review jobs
              </Button>
            </div>
          </section>
        )}

        <div className="octo-data-grid">
          <section className="octo-panel">
            <div className="octo-panel__header">
              <div>
                <h2 className="octo-panel__title">Recently added</h2>
                <p className="octo-panel__subtitle">{files.length} {files.length === 1 ? 'file' : 'files'} in this workspace</p>
              </div>
              <button className="octo-text-link" onClick={() => setView('files')}>View all</button>
            </div>
            <div className="octo-panel__body">
              {recentFiles.length === 0 ? (
                <EmptyState title="Nothing here yet" copy="Add a file to start building this workspace." />
              ) : (
                <div className="octo-list">
                  {recentFiles.map((file) => (
                    <div className="octo-file-row" key={file.id}>
                      <div className="octo-file-row__main">
                        <FileKind mimeType={file.mimeType} />
                        <div style={{ minWidth: 0 }}>
                          <div className="octo-file-row__name">{file.name}</div>
                          <div className="octo-file-row__meta">{formatBytes(file.sizeBytes)} · {file.mimeType}</div>
                        </div>
                      </div>
                      <span className="octo-file-row__date">{formatDate(file.updatedAt || file.createdAt)}</span>
                      <span className={'octo-status' + (file.archiveState === 'archived_drive' ? '' : ' octo-status--good')}>
                        {file.archiveState === 'archived_drive' ? 'Archived' : 'Ready'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <div className="octo-page-stack">
            <section className="octo-panel">
              <div className="octo-panel__header">
                <div>
                  <h2 className="octo-panel__title">Gallery</h2>
                  <p className="octo-panel__subtitle">{galleryItems.length} visual {galleryItems.length === 1 ? 'item' : 'items'}</p>
                </div>
                <button className="octo-text-link" onClick={() => setView('gallery')}>Open</button>
              </div>
              <div className="octo-panel__body">
                {recentMedia.length === 0 ? (
                  <EmptyState title="Your gallery is waiting" copy="Images and videos appear here after they are added to the workspace." />
                ) : (
                  <button className="octo-media-preview" onClick={() => setView('gallery')} aria-label="Open workspace gallery">
                    {recentMedia.map((item) => (
                      <span className="octo-media-preview__item" key={item.id}>
                        <img src={item.thumbnailUrl} alt="" />
                        <span className="octo-media-preview__shade" />
                        <span className="octo-media-preview__name">{item.name}</span>
                      </span>
                    ))}
                  </button>
                )}
              </div>
            </section>

            <section className="octo-panel">
              <div className="octo-panel__header">
                <div>
                  <h2 className="octo-panel__title">Recent activity</h2>
                  <p className="octo-panel__subtitle">What changed in this workspace</p>
                </div>
                <button className="octo-text-link" onClick={() => setView('operations')}>All activity</button>
              </div>
              <div className="octo-panel__body">
                {latestActivity.length === 0 ? (
                  <p className="octo-panel__subtitle">Activity will appear here as workspace jobs run.</p>
                ) : (
                  <div className="octo-list">
                    {latestActivity.map((event) => (
                      <div className="octo-file-row" key={event.id}>
                        <span className="octo-file-icon"><Icon name="clock" size={16} /></span>
                        <div style={{ minWidth: 0 }}>
                          <div className="octo-file-row__name">{event.summary}</div>
                          <div className="octo-file-row__meta">{formatDate(event.createdAt)}</div>
                        </div>
                        <span />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </>
    );
  };

  const renderFiles = () => (
    <div className="octo-page-stack">
      {fileActionError && <p className="octo-error" role="alert">{fileActionError}</p>}
      {activeContext?.capabilities.canUploadFiles && (
        <section className="octo-upload-box">
          <div>
            <h2 className="octo-upload-box__title">Add something to this workspace</h2>
            <p className="octo-upload-box__copy">Upload a file from this device or create a plain text file.</p>
          </div>
          <div className="octo-actions">{uploadActions}</div>
        </section>
      )}
      <section className="octo-panel">
        <div className="octo-panel__header">
          <div>
            <h2 className="octo-panel__title">All files</h2>
            <p className="octo-panel__subtitle">{files.length} {files.length === 1 ? 'item' : 'items'}</p>
          </div>
        </div>
        {files.length === 0 ? (
          <div className="octo-panel__body">
            <EmptyState title="Your workspace is empty" copy="Add a file and it will be ready to find here." />
          </div>
        ) : (
          <div className="octo-table-wrap">
            <table className="octo-table">
              <thead>
                <tr><th>Name</th><th>Type</th><th>Size</th><th>Added</th><th>Status</th><th aria-label="Actions" /></tr>
              </thead>
              <tbody>
                {files.map((file) => {
                  const archived = file.archiveState === 'archived_drive';
                  const inProgress = file.archiveState === 'archiving' || file.archiveState === 'restoring';
                  const issue = file.archiveState === 'reconciliation_required';
                  const status = issue ? 'Needs attention' : inProgress ? 'In progress' : archived ? 'Archived' : 'Ready';
                  const statusClass = issue ? ' octo-status--danger' : inProgress ? ' octo-status--warning' : archived ? '' : ' octo-status--good';
                  return (
                    <tr key={file.id}>
                      <td>
                        <div className="octo-file-row__main">
                          <FileKind mimeType={file.mimeType} />
                          <span>{file.name}</span>
                        </div>
                      </td>
                      <td>{file.mimeType}</td>
                      <td>{formatBytes(file.sizeBytes)}</td>
                      <td>{formatDate(file.createdAt)}</td>
                      <td><span className={'octo-status' + statusClass}>{status}</span></td>
                      <td>
                        <div className="octo-inline-actions">
                          {onDownloadFile && (
                            <Button className="octo-button octo-button--quiet" size="small" variant="outlined" onClick={() => void runFileAction(() => onDownloadFile(file.id), 'File download failed.')}>
                              Download
                            </Button>
                          )}
                          {!inProgress && (archived ? onRestoreFile : onArchiveFile) && (
                            <Button
                              className="octo-button octo-button--quiet"
                              size="small"
                              variant="outlined"
                              onClick={() => void runFileAction(() => archived ? onRestoreFile!(file.id) : onArchiveFile!(file.id), archived ? 'File restore failed.' : 'File archive failed.')}
                            >
                              {archived ? 'Restore' : 'Archive'}
                            </Button>
                          )}
                          {onDeleteFile && activeContext?.capabilities.canDeleteWorkspace && (
                            <Button className="octo-button octo-button--danger" size="small" variant="outlined" onClick={() => void runFileAction(() => onDeleteFile(file.id), 'File deletion failed.')}>
                              Remove
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );

  const renderAccess = () => {
    const retentionDays = workspaces.find((workspace) => workspace.id === activeContext?.workspace.id)?.retentionDays;
    return (
    <div className="octo-page-stack">
      {activeContext && (
        <div className="octo-settings-grid">
          <section className="octo-panel">
            <div className="octo-panel__header">
              <div>
                <h2 className="octo-panel__title">Workspace details</h2>
                <p className="octo-panel__subtitle">Your place in this workspace</p>
              </div>
            </div>
            <div className="octo-panel__body">
              <div className="octo-settings-row"><span className="octo-settings-row__label">Workspace</span><span className="octo-settings-row__value">{activeContext.workspace.name}</span></div>
              <div className="octo-settings-row"><span className="octo-settings-row__label">Your role</span><span className="octo-settings-row__value">{activeContext.role}</span></div>
              <div className="octo-settings-row"><span className="octo-settings-row__label">Automatic archive</span><span className="octo-settings-row__value">{retentionDays ? 'After ' + retentionDays + ' days' : 'Off'}</span></div>
              <div className="octo-settings-row"><span className="octo-settings-row__label">Description</span><span className="octo-settings-row__value">{activeContext.workspace.description || 'Not set'}</span></div>
              {onDeleteWorkspace && activeContext.capabilities.canDeleteWorkspace && (
                <div className="octo-settings-row">
                  <span className="octo-settings-row__label">Workspace</span>
                  <Button className="octo-button octo-button--danger" variant="outlined" size="small" onClick={() => { setDeleteError(null); setIsDeleteWsOpen(true); }}>Delete workspace</Button>
                </div>
              )}
            </div>
          </section>

          <section className="octo-panel">
            <div className="octo-panel__header">
              <div>
                <h2 className="octo-panel__title">Share links</h2>
                <p className="octo-panel__subtitle">Read-only access to this workspace gallery</p>
              </div>
            </div>
            <div className="octo-panel__body">
              {createdShareUrl && (
                <Alert severity="success" sx={{ mb: 2, wordBreak: 'break-all' }}>
                  Copy this link now. Octo only shows the secret once: {createdShareUrl}
                </Alert>
              )}
              {shareError && <p className="octo-error" role="alert">{shareError}</p>}
              {onCreateShare && activeContext.capabilities.canManageSettings && (
                <div className="octo-actions" style={{ marginBottom: 15 }}>
                  <select className="octo-input" aria-label="Share link expiration" value={shareExpiry} onChange={(event) => setShareExpiry(Number(event.target.value))} style={{ width: 180 }}>
                    <option value={0}>No expiry</option>
                    <option value={1}>1 hour</option>
                    <option value={24}>24 hours</option>
                    <option value={168}>7 days</option>
                  </select>
                  <Button className="octo-button" variant="contained" onClick={() => void handleCreateShare()}>Create link</Button>
                </div>
              )}
              {shares.length === 0 ? (
                <p className="octo-panel__subtitle">No share links for this workspace.</p>
              ) : (
                <div className="octo-list">
                  {shares.map((share) => (
                    <div className="octo-settings-row" key={share.id}>
                      <span className={'octo-status' + (share.active ? ' octo-status--good' : '')}>{share.active ? 'Active' : share.revokedAt ? 'Revoked' : 'Expired'}</span>
                      <span className="octo-settings-row__value">{share.permission} · {share.validUntil ? 'Until ' + formatDate(share.validUntil) : 'No expiry'} · {share.accessCount} views</span>
                      {onRevokeShare && share.active && (
                        <Button className="octo-button octo-button--danger" variant="outlined" size="small" onClick={() => void onRevokeShare(share.id)}>Revoke</Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      <div className="octo-access-block">
        <KeyManager
          apiKeys={apiKeys}
          workspaceName={activeWorkspaceName}
          isPlatformOwner={Boolean(principal?.isPlatformOwner)}
          onCreateApiKey={onCreateApiKey}
          onRevokeApiKey={onRevokeApiKey}
        />
      </div>
    </div>
    );
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {!principal ? (
        <div className="octo-login">
          <section className="octo-login__story">
            <Brand />
            <div>
              <h1 className="octo-login__headline">Your work,<br /><span>within reach.</span></h1>
              <p className="octo-login__copy">A calm home for the files and activity that matter to your workspace.</p>
            </div>
            <span className="octo-login__footnote">PRIVATE WORKSPACE · OCTO</span>
          </section>
          <section className="octo-login__action">
            <div className="octo-login__card">
              <span className="octo-login__eyebrow">Sign in to continue</span>
              <h2 className="octo-login__title">Welcome back</h2>
              <p className="octo-login__description">Choose how you want to enter your workspace.</p>
              <div className="octo-login__buttons">
                {googleAuthEnabled && (
                  <Button className="octo-button" variant="contained" fullWidth onClick={onSignInWithGoogle} disabled={isLoading}>
                    Continue with Google
                  </Button>
                )}
                {onSignInAsGuest && (
                  <Button className="octo-button octo-button--quiet" variant="outlined" fullWidth onClick={onSignInAsGuest} disabled={isLoading}>
                    Continue as guest
                  </Button>
                )}
              </div>
              {!googleAuthEnabled && (
                <p className="octo-login__note">Google sign-in is not configured for this environment. Guest access remains available.</p>
              )}
            </div>
          </section>
        </div>
      ) : (
        <div className="octo-app">
          <div className="octo-shell">
            <aside className="octo-sidebar">
              <div className="octo-sidebar__brand"><Brand /></div>
              <label className="octo-eyebrow" htmlFor="workspace-select" style={{ padding: '0 10px 8px' }}>Workspace</label>
              <div className="octo-workspace-select">
                <span className="octo-workspace-select__icon">{activeWorkspaceName.slice(0, 1).toUpperCase()}</span>
                <span className="octo-workspace-select__copy">
                  <span className="octo-workspace-select__name">{activeWorkspaceName}</span>
                  <span className="octo-workspace-select__meta">{activeContext?.role ?? 'Choose a workspace'}</span>
                </span>
                <Icon name="chevron" size={15} />
                <select
                  id="workspace-select"
                  aria-label="Select workspace"
                  value={selectedWsId}
                  onChange={(event) => handleWorkspaceChange(event.target.value)}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', zIndex: 2 }}
                >
                  {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
                </select>
              </div>

              <nav className="octo-nav" aria-label="Workspace">
                {NAV_ITEMS.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className="octo-nav__item"
                    aria-current={view === item.id ? 'page' : undefined}
                    aria-label={VIEW_LABELS[item.id]}
                    title={VIEW_LABELS[item.id]}
                    onClick={() => setView(item.id)}
                  >
                    <Icon name={item.icon} size={17} />
                    <span className="octo-nav__label">{VIEW_LABELS[item.id]}</span>
                    {item.id === 'operations' && failedJobs.length > 0 && <span className="octo-nav__count">{failedJobs.length}</span>}
                  </button>
                ))}
              </nav>

              {onCreateWorkspace && (
                <button className="octo-nav__item" type="button" style={{ marginTop: 14 }} onClick={() => { setWorkspaceError(null); setIsCreateWsOpen(true); }}>
                  <Icon name="plus" size={17} /><span className="octo-nav__label">New workspace</span>
                </button>
              )}

              <div className="octo-sidebar__bottom">
                <button className="octo-nav__item" type="button" onClick={() => setDesignSystem(designSystem === 'midnight' ? 'paper' : 'midnight')} aria-label={'Switch to ' + (designSystem === 'midnight' ? 'light' : 'dark') + ' appearance'}>
                  <Icon name={designSystem === 'midnight' ? 'sun' : 'moon'} size={17} />
                  <span className="octo-nav__label">Appearance</span>
                  <span className="octo-nav__count">{designSystem === 'midnight' ? 'Dark' : 'Light'}</span>
                </button>
                <div className="octo-user">
                  <span className="octo-user__avatar">
                    {principal.avatarUrl ? <img src={principal.avatarUrl} alt="" /> : principal.email.charAt(0).toUpperCase()}
                  </span>
                  <span className="octo-user__copy">
                    <span className="octo-user__name">{principal.displayName || principal.email}</span>
                    <span className="octo-user__email">{principal.isGuest ? 'Guest session' : principal.email}</span>
                  </span>
                  <button className="octo-text-link" onClick={onSignOut} aria-label="Sign out" disabled={isLoading}><Icon name="signout" size={16} /></button>
                </div>
              </div>
            </aside>

            <main className="octo-main">
              <header className="octo-topbar">
                <div className="octo-breadcrumb"><span>{activeWorkspaceName}</span><span>/</span><strong>{VIEW_LABELS[view]}</strong></div>
                <div className="octo-topbar__actions">
                  <button className="octo-theme-toggle MuiButton-root" type="button" onClick={() => setDesignSystem(designSystem === 'midnight' ? 'paper' : 'midnight')} aria-label={'Switch to ' + (designSystem === 'midnight' ? 'light' : 'dark') + ' appearance'} title={'Switch to ' + (designSystem === 'midnight' ? 'light' : 'dark') + ' appearance'}>
                    <Icon name={designSystem === 'midnight' ? 'sun' : 'moon'} />
                  </button>
                </div>
              </header>

              <div className="octo-content">
                {workspaces.length === 0 ? (
                  <section className="octo-panel">
                    <div className="octo-panel__body">
                      <EmptyState
                        title="No workspace yet"
                        copy="Create a workspace to start storing files and sharing them with the people or agents you choose."
                        action={onCreateWorkspace && <Button className="octo-button" variant="contained" onClick={() => setIsCreateWsOpen(true)}>Create workspace</Button>}
                      />
                    </div>
                  </section>
                ) : !activeContext ? (
                  <section className="octo-panel"><div className="octo-panel__body"><EmptyState title="Loading workspace" copy="Your workspace details are on their way." /></div></section>
                ) : (
                  <>
                    {view !== 'overview' && view !== 'gallery' && view !== 'operations' && (
                      <header className="octo-page-header">
                        <div>
                          <span className="octo-eyebrow">{activeWorkspaceName}</span>
                          <h1 className="octo-page-header__title">{VIEW_LABELS[view]}</h1>
                          <p className="octo-page-header__subtitle">{pageSubtitle[view]}</p>
                        </div>
                      </header>
                    )}
                    {fileActionError && view !== 'files' && <p className="octo-error" role="alert">{fileActionError}</p>}
                    {view === 'overview' && renderOverview()}
                    {view === 'files' && renderFiles()}
                    {view === 'gallery' && <Gallery items={galleryItems} workspaceName={activeWorkspaceName} />}
                    {view === 'operations' && (
                      <OperationsPage jobs={jobs} activity={activity} onRetryJob={onRetryJob} onRunWorker={onRunWorker} />
                    )}
                    {view === 'access' && renderAccess()}
                  </>
                )}
              </div>
            </main>
          </div>
        </div>
      )}

      <input
        ref={binaryInputRef}
        type="file"
        hidden
        aria-label="Choose files to upload"
        onChange={(event) => {
          const file = event.target.files?.[0];
          void handleBinaryFile(file);
          event.target.value = '';
        }}
      />

      <Dialog open={isUploadDialogOpen} onClose={() => setIsUploadDialogOpen(false)} maxWidth="sm" fullWidth PaperProps={{ className: 'octo-dialog-paper' }}>
        <DialogTitle>Create a text file</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: '12px !important' }}>
          <TextField label="File name" placeholder="notes.txt" value={uploadFileName} onChange={(event) => setUploadFileName(event.target.value)} fullWidth />
          <TextField label="Content" placeholder="Write something useful…" value={uploadFileContent} onChange={(event) => setUploadFileContent(event.target.value)} multiline minRows={5} fullWidth />
          {fileActionError && <Alert severity="error">{fileActionError}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setIsUploadDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!uploadFileName.trim() || isUploading} onClick={() => void handleUpload()}>Save file</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={isCreateWsOpen} onClose={() => setIsCreateWsOpen(false)} maxWidth="sm" fullWidth PaperProps={{ className: 'octo-dialog-paper' }}>
        <DialogTitle>New workspace</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: '12px !important' }}>
          <TextField label="Name" value={newWsName} onChange={(event) => setNewWsName(event.target.value)} fullWidth />
          <TextField label="Description" value={newWsDescription} onChange={(event) => setNewWsDescription(event.target.value)} fullWidth />
          <TextField label="Automatic archive after (days)" type="number" value={newWsRetention || ''} onChange={(event) => setNewWsRetention(Number(event.target.value) || 0)} fullWidth helperText="Leave empty to keep automatic archive off." />
          {workspaceError && <Alert severity="error">{workspaceError}</Alert>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setIsCreateWsOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!newWsName.trim()} onClick={() => void handleCreateWorkspace()}>Create workspace</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(createdWsSecret)} onClose={() => setCreatedWsSecret(null)} maxWidth="sm" fullWidth PaperProps={{ className: 'octo-dialog-paper' }}>
        <DialogTitle>Workspace created</DialogTitle>
        <DialogContent>
          <p className="octo-panel__subtitle">Save this key for {createdWsSecret?.name}. It will not be shown again.</p>
          <pre style={{ overflowX: 'auto', padding: 15, borderRadius: 10, color: 'var(--octo-text)', background: 'var(--octo-raised)' }}>{createdWsSecret?.secret}</pre>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button variant="contained" onClick={() => setCreatedWsSecret(null)}>Done</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={isDeleteWsOpen} onClose={() => setIsDeleteWsOpen(false)} maxWidth="sm" fullWidth PaperProps={{ className: 'octo-dialog-paper' }}>
        <DialogTitle>Delete {activeContext?.workspace.name}?</DialogTitle>
        <DialogContent sx={{ display: 'grid', gap: 2, pt: '12px !important' }}>
          <Alert severity="warning">This permanently deletes the workspace and its files, keys, shares, memberships, and jobs.</Alert>
          {!confirmSecretSet ? (
            <>
              <p className="octo-panel__subtitle">Set a confirmation secret before deleting a workspace.</p>
              {onSetConfirmSecret && (
                <>
                  <TextField label="New confirmation secret (8 characters minimum)" type="password" value={setupSecret} onChange={(event) => setSetupSecret(event.target.value)} fullWidth />
                  <TextField label="Current secret, if changing one" type="password" value={setupCurrentSecret} onChange={(event) => setSetupCurrentSecret(event.target.value)} fullWidth />
                  {setupError && <Alert severity="error">{setupError}</Alert>}
                  <Button variant="contained" disabled={setupSecret.length < 8} onClick={() => void handleSetConfirmSecret()}>Set confirmation secret</Button>
                </>
              )}
            </>
          ) : (
            <>
              <TextField label={'Type ' + (activeContext?.workspace.slug ?? '') + ' to confirm'} value={deleteSlug} onChange={(event) => setDeleteSlug(event.target.value)} fullWidth />
              <TextField label="Confirmation secret" type="password" value={deleteSecret} onChange={(event) => setDeleteSecret(event.target.value)} fullWidth />
              {deleteError && <Alert severity="error">{deleteError}</Alert>}
            </>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setIsDeleteWsOpen(false)}>Cancel</Button>
          {confirmSecretSet && (
            <Button color="error" variant="contained" disabled={!deleteSecret || deleteSlug !== activeContext?.workspace.slug} onClick={() => void handleDeleteWorkspace()}>
              Delete workspace
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  );
};
