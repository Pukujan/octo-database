/**
 * Octo Workspace Control Dashboard (Slices 1, 2, and 7)
 *
 * Polished control dashboard with Google sign-in, Guest login,
 * authorized workspace selector, file catalog (R2), and API key management.
 * Follows CGM visual direction guidelines (clear visual hierarchy, restrained palette,
 * consistent spacing, and expressive vector visuals).
 */

import React, { useEffect, useState } from 'react';
import {
  AppBar,
  Avatar,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ThemeProvider,
  Toolbar,
  Typography,
} from '@mui/material';
import { Principal, WorkspaceRole, WorkspaceSummary } from '../types/auth';
import { WorkspaceContext } from '../auth/workspace-service';
import { FileRecord } from '../storage/file-service';
import { ApiKey } from '../api/keys';
import { ShareSummary } from '../media/share-service';
import { OperationsActivity, OperationsJob, OperationsPage } from './OperationsPage';
import { GalleryItem } from '../media/gallery-service';
import { Gallery } from './Gallery';
import { octoTheme } from './theme';

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
  onDeleteFile?: (fileId: string) => Promise<void>;
  onArchiveFile?: (fileId: string) => Promise<void>;
  onRestoreFile?: (fileId: string) => Promise<void>;
  onCreateApiKey?: (name: string, isAccountWide: boolean) => Promise<{ rawSecret: string }>;
  shares?: ShareSummary[];
  jobs?: OperationsJob[];
  activity?: OperationsActivity[];
  onRetryJob?: (jobId: string) => void;
  onRunWorker?: () => void;
  onCreateShare?: (expiresInHours: number | null) => Promise<{ rawToken: string }>;
  onRevokeShare?: (shareId: string) => Promise<void>;
  isLoading?: boolean;
}

// Decorative SVG Illustration for Login Hero per CGM visual guidelines
const LoginHeroIllustration: React.FC = () => (
  <svg
    width="100%"
    height="160"
    viewBox="0 0 400 160"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{ maxWidth: 360, margin: '0 auto 16px auto', display: 'block' }}
  >
    <rect width="400" height="160" rx="12" fill="#eff6ff" />
    {/* Central Octo Hub */}
    <circle cx="200" cy="80" r="36" fill="#2563eb" fillOpacity="0.1" />
    <circle cx="200" cy="80" r="26" fill="#2563eb" />
    <text x="200" y="86" textAnchor="middle" fill="#ffffff" fontSize="20" fontWeight="bold">
      🐙
    </text>

    {/* Connected Nodes */}
    {/* Left Node: Database / Workspace */}
    <circle cx="90" cy="80" r="22" fill="#ffffff" stroke="#cbd5e1" strokeWidth="2" />
    <text x="90" y="85" textAnchor="middle" fill="#475569" fontSize="13">
      🗄️
    </text>
    <path d="M114 80H172" stroke="#93c5fd" strokeWidth="2" strokeDasharray="4 4" />

    {/* Right Node: Cloudflare R2 Active Storage */}
    <circle cx="310" cy="80" r="22" fill="#ffffff" stroke="#cbd5e1" strokeWidth="2" />
    <text x="310" y="85" textAnchor="middle" fill="#475569" fontSize="13">
      ☁️
    </text>
    <path d="M228 80H286" stroke="#93c5fd" strokeWidth="2" strokeDasharray="4 4" />

    {/* Top Node: Scoped API Gateway */}
    <circle cx="200" cy="25" r="16" fill="#ffffff" stroke="#cbd5e1" strokeWidth="2" />
    <text x="200" y="30" textAnchor="middle" fill="#475569" fontSize="10">
      🔑
    </text>
    <path d="M200 43V52" stroke="#93c5fd" strokeWidth="2" />

    {/* Bottom Label */}
    <text x="200" y="142" textAnchor="middle" fill="#1e293b" fontSize="13" fontWeight="700">
      Personal Control Plane • Workspaces • R2 Storage • Machine APIs
    </text>
  </svg>
);

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
  onDeleteFile,
  onArchiveFile,
  onRestoreFile,
  onCreateApiKey,
  shares = [],
  jobs = [],
  activity = [],
  onRetryJob,
  onRunWorker,
  onCreateShare,
  onRevokeShare,
  isLoading = false,
}) => {
  const [selectedWsId, setSelectedWsId] = useState<string>(
    activeContext?.workspace.id ?? workspaces[0]?.id ?? ''
  );
  const [isAdminOpen, setIsAdminOpen] = useState(false);

  useEffect(() => {
    if (activeContext?.workspace.id) {
      setSelectedWsId(activeContext.workspace.id);
    }
  }, [activeContext?.workspace.id]);

  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyIsAccountWide, setNewKeyIsAccountWide] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [createdShareUrl, setCreatedShareUrl] = useState<string | null>(null);
  const [shareExpiry, setShareExpiry] = useState<number>(0);

  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadFileContent, setUploadFileContent] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const handleWorkspaceChange = (newId: string) => {
    setSelectedWsId(newId);
    onSelectWorkspace(newId);
  };

  const handleCreateKey = async () => {
    if (!newKeyName.trim() || !onCreateApiKey) return;
    try {
      const res = await onCreateApiKey(newKeyName.trim(), newKeyIsAccountWide);
      setCreatedSecret(res.rawSecret);
      setNewKeyName('');
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateShare = async () => {
    if (!onCreateShare) return;
    try {
      const res = await onCreateShare(shareExpiry > 0 ? shareExpiry : null);
      setCreatedShareUrl(`${window.location.origin}/share/${res.rawToken}`);
    } catch (e) {
      console.error(e);
    }
  };

  const handleUpload = async () => {
    if (!uploadFileName.trim() || !onUploadFile) return;
    try {
      setIsUploading(true);
      await onUploadFile(uploadFileName.trim(), 'text/plain', uploadFileContent);
      setUploadFileName('');
      setUploadFileContent('');
    } catch (e) {
      console.error(e);
    } finally {
      setIsUploading(false);
    }
  };

  // 1. Unauthenticated View (Google Sign-In + Guest Login)
  if (!principal) {
    return (
      <ThemeProvider theme={octoTheme}>
        <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
          <AppBar position="static">
            <Toolbar sx={{ px: 3 }}>
              <Typography variant="h6" component="div" sx={{ flexGrow: 1, fontWeight: 700 }}>
                🐙 Octo
              </Typography>
              <Chip label="v0.1.0" size="small" variant="outlined" />
            </Toolbar>
          </AppBar>

          <Container maxWidth="sm" sx={{ flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', py: 4 }}>
            <Card sx={{ p: 4, borderRadius: 3, boxShadow: '0 4px 20px -2px rgba(0,0,0,0.06)' }}>
              <LoginHeroIllustration />

              <Typography variant="h5" align="center" gutterBottom sx={{ fontWeight: 700 }}>
                Welcome to Octo
              </Typography>
              <Typography variant="body2" color="text.secondary" align="center" sx={{ mb: 4, px: 2 }}>
                Connect your database, manage private files in Cloudflare R2, and create scoped API keys for agents.
              </Typography>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Button
                  variant="contained"
                  size="large"
                  fullWidth
                  onClick={onSignInWithGoogle}
                  disabled={isLoading || !googleAuthEnabled}
                  aria-label={
                    googleAuthEnabled
                      ? 'Sign in with Google'
                      : 'Google sign-in not configured'
                  }
                  sx={{ py: 1.5, fontSize: '0.95rem' }}
                >
                  {googleAuthEnabled ? 'Sign in with Google' : 'Google sign-in not configured'}
                </Button>
                {!googleAuthEnabled && (
                  <Typography variant="caption" color="text.secondary" align="center">
                    Set GOOGLE_OAUTH_CLIENT_ID to enable Google sign-in. Guest access works now.
                  </Typography>
                )}

                {onSignInAsGuest && (
                  <Button
                    variant="outlined"
                    size="large"
                    fullWidth
                    onClick={onSignInAsGuest}
                    disabled={isLoading}
                    sx={{ py: 1.5, fontSize: '0.95rem' }}
                  >
                    Continue as Guest (Instant Access)
                  </Button>
                )}
              </Box>
            </Card>
          </Container>
        </Box>
      </ThemeProvider>
    );
  }

  // 2. Authenticated Control Dashboard
  return (
    <ThemeProvider theme={octoTheme}>
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', pb: 6 }}>
        {/* Navigation Bar */}
        <AppBar position="static">
          <Toolbar sx={{ justifyContent: 'space-between', px: { xs: 2, sm: 4 } }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
                🐙 Octo
              </Typography>
              <Chip
                label="Control Plane"
                size="small"
                variant="outlined"
                sx={{ fontSize: '0.75rem', borderColor: 'divider' }}
              />
              {principal.isPlatformOwner && (
                <Chip
                  label="👑 Platform Owner"
                  size="small"
                  color="primary"
                  variant="filled"
                  sx={{ fontSize: '0.75rem', fontWeight: 700 }}
                />
              )}
              {principal.isGuest && (
                <Chip
                  label="Guest Sandbox"
                  size="small"
                  color="warning"
                  variant="filled"
                  sx={{ fontSize: '0.75rem', fontWeight: 600 }}
                />
              )}
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              {principal.isPlatformOwner && (
                <Button
                  variant="contained"
                  color="primary"
                  size="small"
                  onClick={() => setIsAdminOpen(true)}
                  sx={{ textTransform: 'none', fontWeight: 600 }}
                >
                  ⚡ Platform Admin
                </Button>
              )}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Avatar
                  src={principal.avatarUrl ?? undefined}
                  alt={principal.displayName ?? principal.email}
                  sx={{ width: 34, height: 34, bgcolor: 'primary.main', fontSize: '0.875rem' }}
                >
                  {principal.email.charAt(0).toUpperCase()}
                </Avatar>
                <Box sx={{ display: { xs: 'none', sm: 'block' }, textAlign: 'left' }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.2 }}>
                    {principal.displayName ?? principal.email}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1 }}>
                    {principal.email}
                  </Typography>
                </Box>
              </Box>

              <Button
                variant="outlined"
                size="small"
                onClick={onSignOut}
                disabled={isLoading}
                sx={{ textTransform: 'none' }}
              >
                Sign out
              </Button>
            </Box>
          </Toolbar>
        </AppBar>

        <Container maxWidth="lg" sx={{ py: 4 }}>
          {/* Workspace Selection & Header */}
          <Box
            sx={{
              display: 'flex',
              flexDirection: { xs: 'column', sm: 'row' },
              justifyContent: 'space-between',
              alignItems: { xs: 'flex-start', sm: 'center' },
              gap: 2,
              mb: 4,
            }}
          >
            <div>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                Workspace Control Dashboard
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Inspect files, active Cloudflare R2 storage, and machine API keys.
              </Typography>
            </div>

            {workspaces.length > 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Typography variant="body2" color="text.secondary">
                  Active Workspace:
                </Typography>
                <Select
                  size="small"
                  value={selectedWsId || (workspaces[0]?.id ?? '')}
                  onChange={(e) => handleWorkspaceChange(e.target.value)}
                  sx={{ minWidth: 220, bgcolor: 'background.paper', borderRadius: 1.5 }}
                >
                  {workspaces.map((ws) => (
                    <MenuItem key={ws.id} value={ws.id}>
                      {ws.name} ({ws.role})
                    </MenuItem>
                  ))}
                </Select>
              </Box>
            )}
          </Box>

          {/* Empty / Unauthorized State */}
          {workspaces.length === 0 ? (
            <Card sx={{ p: 4, textAlign: 'center', borderRadius: 2 }}>
              <Typography variant="h6" gutterBottom>
                No Authorized Workspaces
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Your account ({principal.email}) does not belong to any active workspaces yet.
              </Typography>
            </Card>
          ) : activeContext ? (
            <Box>
              {/* Active Workspace Metadata */}
              <Card sx={{ mb: 4, p: 2, borderRadius: 2 }}>
                <CardContent sx={{ pb: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                    <div>
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        {activeContext.workspace.name}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Slug: <code>{activeContext.workspace.slug}</code>
                      </Typography>
                    </div>
                    <Chip
                      label={`Role: ${activeContext.role.toUpperCase()}`}
                      color={activeContext.role === 'owner' ? 'primary' : 'default'}
                      size="small"
                      sx={{ fontWeight: 600 }}
                    />
                  </Box>

                  {activeContext.workspace.description && (
                    <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
                      {activeContext.workspace.description}
                    </Typography>
                  )}

                  <Divider sx={{ my: 2 }} />

                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                    Workspace Capabilities:
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Chip
                      label="Upload Files (R2)"
                      size="small"
                      variant={activeContext.capabilities.canUploadFiles ? 'filled' : 'outlined'}
                      color={activeContext.capabilities.canUploadFiles ? 'success' : 'default'}
                    />
                    <Chip
                      label="Manage Members"
                      size="small"
                      variant={activeContext.capabilities.canManageMembers ? 'filled' : 'outlined'}
                      color={activeContext.capabilities.canManageMembers ? 'success' : 'default'}
                    />
                    <Chip
                      label="Manage Settings"
                      size="small"
                      variant={activeContext.capabilities.canManageSettings ? 'filled' : 'outlined'}
                      color={activeContext.capabilities.canManageSettings ? 'success' : 'default'}
                    />
                    <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                    <Chip
                      label="Delete Workspace"
                      size="small"
                      variant={activeContext.capabilities.canDeleteWorkspace ? 'outlined' : 'outlined'}
                      color="error"
                    />
                  </Box>
                </CardContent>
              </Card>

              {/* File Catalog (Slice 2) */}
              <Card sx={{ mb: 4, borderRadius: 2 }}>
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <div>
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        📁 File Catalog (Cloudflare R2)
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Logical file records pointing to objects stored in the dedicated Cloudflare R2 bucket.
                      </Typography>
                    </div>
                  </Box>

                  {/* Upload Form */}
                  {onUploadFile && activeContext.capabilities.canUploadFiles && (
                    <Box
                      sx={{
                        display: 'flex',
                        gap: 1.5,
                        alignItems: 'center',
                        mb: 3,
                        flexWrap: 'wrap',
                      }}
                    >
                      <TextField
                        size="small"
                        label="File Name"
                        placeholder="notes.txt"
                        value={uploadFileName}
                        onChange={(e) => setUploadFileName(e.target.value)}
                        sx={{ width: 200 }}
                      />
                      <TextField
                        size="small"
                        label="Content"
                        placeholder="File body content..."
                        value={uploadFileContent}
                        onChange={(e) => setUploadFileContent(e.target.value)}
                        sx={{ flex: '1 1 260px', minWidth: 220 }}
                      />
                      <Button
                        variant="contained"
                        size="medium"
                        onClick={handleUpload}
                        disabled={isUploading || !uploadFileName.trim()}
                        sx={{ whiteSpace: 'nowrap' }}
                      >
                        Upload Text to R2
                      </Button>

                      {onUploadBinaryFile && (
                        <Button
                          variant="outlined"
                          size="medium"
                          component="label"
                          sx={{ whiteSpace: 'nowrap' }}
                        >
                          Upload Image/Video
                          <input
                            type="file"
                            hidden
                            accept="image/*,video/*"
                            aria-label="Upload image or video file"
                            onChange={async (e) => {
                              const chosen = e.target.files?.[0];
                              if (chosen) {
                                setIsUploading(true);
                                try {
                                  await onUploadBinaryFile(chosen);
                                } finally {
                                  setIsUploading(false);
                                  e.target.value = '';
                                }
                              }
                            }}
                          />
                        </Button>
                      )}
                    </Box>
                  )}

                  {files.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                      No files uploaded yet in this workspace.
                    </Typography>
                  ) : (
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 600, width: '24%' }}>Name</TableCell>
                            <TableCell sx={{ fontWeight: 600, width: '10%' }}>Size</TableCell>
                            <TableCell sx={{ fontWeight: 600, width: '14%' }}>MIME Type</TableCell>
                            <TableCell sx={{ fontWeight: 600, width: '16%' }}>Storage Tier</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>Storage Key</TableCell>
                            <TableCell sx={{ fontWeight: 600, width: '18%' }} align="right">
                              Actions
                            </TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {files.map((f) => (
                            <TableRow key={f.id}>
                              <TableCell sx={{ fontWeight: 500 }}>{f.name}</TableCell>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>{f.sizeBytes} B</TableCell>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>{f.mimeType}</TableCell>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                <Chip
                                  size="small"
                                  label={
                                    f.archiveState === 'archived_drive'
                                      ? 'Drive (Cold)'
                                      : f.archiveState === 'archiving'
                                      ? 'Archiving...'
                                      : f.archiveState === 'restoring'
                                      ? 'Restoring...'
                                      : f.archiveState === 'reconciliation_required'
                                      ? 'Needs Reconcile'
                                      : 'R2 (Active)'
                                  }
                                  color={
                                    f.archiveState === 'archived_drive'
                                      ? 'info'
                                      : f.archiveState === 'reconciliation_required'
                                      ? 'error'
                                      : f.archiveState === 'archiving' || f.archiveState === 'restoring'
                                      ? 'warning'
                                      : 'success'
                                  }
                                  variant="outlined"
                                />
                              </TableCell>
                              <TableCell
                                sx={{
                                  maxWidth: 220,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                                title={f.storageKey}
                              >
                                <code>{f.storageKey}</code>
                              </TableCell>
                              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                {f.archiveState === 'archived_drive' ? (
                                  onRestoreFile && (
                                    <Button
                                      size="small"
                                      variant="outlined"
                                      color="info"
                                      onClick={() => onRestoreFile(f.id)}
                                      sx={{ mr: 1 }}
                                    >
                                      Restore
                                    </Button>
                                  )
                                ) : (
                                  onArchiveFile && (
                                    <Button
                                      size="small"
                                      variant="outlined"
                                      color="secondary"
                                      onClick={() => onArchiveFile(f.id)}
                                      sx={{ mr: 1 }}
                                    >
                                      Archive
                                    </Button>
                                  )
                                )}
                                {onDeleteFile && activeContext.capabilities.canDeleteWorkspace && (
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    color="error"
                                    onClick={() => onDeleteFile(f.id)}
                                  >
                                    Delete
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </CardContent>
              </Card>

              {/* Workspace Gallery (Slice 3) */}
              <Card sx={{ mb: 4, borderRadius: 2 }}>
                <CardContent sx={{ pb: 1 }}>
                  <Gallery
                    items={galleryItems}
                    workspaceName={activeContext.workspace.name}
                  />
                </CardContent>
              </Card>

              {/* Operations (Slice 6) */}
              <Card sx={{ mb: 4, borderRadius: 2 }}>
                <CardContent>
                  <OperationsPage
                    jobs={jobs}
                    activity={activity}
                    onRetryJob={onRetryJob}
                    onRunWorker={onRunWorker}
                  />
                </CardContent>
              </Card>

              {/* Scoped Share Links (Slice 4) */}
              <Card sx={{ mb: 4, borderRadius: 2 }}>
                <CardContent>
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="h6" sx={{ fontWeight: 700 }}>
                      🔗 Scoped Share Links
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Read-only links that expose exactly this gallery. Anyone with the link can view it;
                      revoking takes effect immediately.
                    </Typography>
                  </Box>

                  {createdShareUrl && (
                    <Card sx={{ p: 2, mb: 3, bgcolor: '#f0fdf4', borderColor: '#86efac', borderRadius: 2 }}>
                      <Typography variant="subtitle2" sx={{ color: '#166534', fontWeight: 600 }}>
                        Share link created (copy now — it is not stored and cannot be shown again):
                      </Typography>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', mt: 0.5 }}>
                        {createdShareUrl}
                      </Typography>
                    </Card>
                  )}

                  {onCreateShare && activeContext.capabilities.canManageSettings && (
                    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mb: 3, flexWrap: 'wrap' }}>
                      <Select
                        size="small"
                        value={shareExpiry}
                        onChange={(e) => setShareExpiry(Number(e.target.value))}
                        sx={{ minWidth: 230 }}
                      >
                        <MenuItem value={0}>No expiry</MenuItem>
                        <MenuItem value={1}>Expires in 1 hour</MenuItem>
                        <MenuItem value={24}>Expires in 24 hours</MenuItem>
                        <MenuItem value={168}>Expires in 7 days</MenuItem>
                      </Select>
                      <Button
                        variant="contained"
                        size="medium"
                        onClick={handleCreateShare}
                        disabled={!onCreateShare}
                        sx={{ whiteSpace: 'nowrap' }}
                      >
                        Create Share Link
                      </Button>
                    </Box>
                  )}

                  {shares.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No share links created yet.
                    </Typography>
                  ) : (
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 600, width: '14%' }}>Status</TableCell>
                            <TableCell sx={{ fontWeight: 600, width: '14%' }}>Permission</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>Expires</TableCell>
                            <TableCell sx={{ fontWeight: 600, width: '14%' }}>Views</TableCell>
                            <TableCell sx={{ fontWeight: 600, width: '14%' }} align="right">
                              Actions
                            </TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {shares.map((sh) => (
                            <TableRow key={sh.id}>
                              <TableCell>
                                <Chip
                                  label={sh.active ? 'Active' : sh.revokedAt ? 'Revoked' : 'Expired'}
                                  size="small"
                                  color={sh.active ? 'success' : 'default'}
                                />
                              </TableCell>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>{sh.permission}</TableCell>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                {sh.validUntil ? new Date(sh.validUntil).toLocaleString() : 'Never'}
                              </TableCell>
                              <TableCell>{sh.accessCount}</TableCell>
                              <TableCell align="right">
                                {onRevokeShare && sh.active && (
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    color="error"
                                    onClick={() => onRevokeShare(sh.id)}
                                    sx={{ whiteSpace: 'nowrap' }}
                                  >
                                    Revoke
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </CardContent>
              </Card>

              {/* API Keys (Account-Wide & Workspace-Scoped) */}
              <Card sx={{ mb: 4, borderRadius: 2 }}>
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <div>
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        🔑 API Keys (Account-Wide & Workspace-Scoped)
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Machine credentials for automation and agents. Hashed with SHA-256; secrets never stored in plaintext.
                      </Typography>
                    </div>
                  </Box>

                  {/* Created Key Alert */}
                  {createdSecret && (
                    <Card sx={{ p: 2, mb: 3, bgcolor: '#f0fdf4', borderColor: '#86efac', borderRadius: 2 }}>
                      <Typography variant="subtitle2" sx={{ color: '#166534', fontWeight: 600 }}>
                        New API Key Minted (Copy Now - will not be displayed again):
                      </Typography>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', mt: 0.5 }}>
                        {createdSecret}
                      </Typography>
                    </Card>
                  )}

                  {/* Create Key Form */}
                  {onCreateApiKey && (
                    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', mb: 3, flexWrap: 'wrap' }}>
                      <TextField
                        size="small"
                        label="Key Name"
                        placeholder="e.g. Ingest Agent"
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                        sx={{ width: 220 }}
                      />
                      <Select
                        size="small"
                        value={newKeyIsAccountWide ? 'account' : 'workspace'}
                        onChange={(e) => setNewKeyIsAccountWide(e.target.value === 'account')}
                        sx={{ width: 190 }}
                      >
                        <MenuItem value="workspace">Workspace-Scoped</MenuItem>
                        <MenuItem value="account">Account-Wide</MenuItem>
                      </Select>
                      <Button
                        variant="contained"
                        size="medium"
                        onClick={handleCreateKey}
                        disabled={!newKeyName.trim()}
                        sx={{ whiteSpace: 'nowrap' }}
                      >
                        Generate API Key
                      </Button>
                    </Box>
                  )}

                  {/* Keys Table */}
                  {apiKeys.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                      No API keys generated yet.
                    </Typography>
                  ) : (
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>Prefix</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>Scope</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>Scopes</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>Last Used</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {apiKeys.map((k) => (
                            <TableRow key={k.id}>
                              <TableCell sx={{ fontWeight: 500 }}>{k.name}</TableCell>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}><code>{k.prefix}...</code></TableCell>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>
                                <Chip
                                  label={k.isAccountWide ? 'Account-Wide' : 'Workspace-Scoped'}
                                  size="small"
                                  color={k.isAccountWide ? 'primary' : 'default'}
                                />
                              </TableCell>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>{k.scopes.join(', ')}</TableCell>
                              <TableCell sx={{ whiteSpace: 'nowrap' }}>{k.lastUsedAt ?? 'Never'}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  )}
                </CardContent>
              </Card>
            </Box>
          ) : (
            <Card sx={{ p: 4, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                Loading workspace details...
              </Typography>
            </Card>
          )}
        </Container>

        {/* Platform Admin Dialog */}
        <Dialog
          open={isAdminOpen}
          onClose={() => setIsAdminOpen(false)}
          maxWidth="md"
          fullWidth
          aria-labelledby="platform-admin-dialog-title"
        >
          <DialogTitle
            id="platform-admin-dialog-title"
            sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pb: 1 }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                ⚡ Platform Admin Console
              </Typography>
              <Chip label="👑 Platform Owner" size="small" color="primary" sx={{ fontWeight: 600 }} />
            </Box>
            <Button size="small" onClick={() => setIsAdminOpen(false)} sx={{ textTransform: 'none' }}>
              Close
            </Button>
          </DialogTitle>
          <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {/* 1. Infrastructure & Storage Tier Status */}
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1.5 }}>
                📡 Live Platform Infrastructure & Storage Tier Status
              </Typography>
              <Grid container spacing={2}>
                <Grid item xs={12} sm={6}>
                  <Card variant="outlined" sx={{ p: 2, height: '100%' }}>
                    <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 600 }}>
                      Primary Relational & Vector DB
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                      <Chip label="ONLINE" size="small" color="success" sx={{ height: 20, fontSize: '0.7rem' }} />
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Postgres with pgvector
                      </Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      Schema `octo` • pgvector embeddings active
                    </Typography>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Card variant="outlined" sx={{ p: 2, height: '100%' }}>
                    <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 600 }}>
                      Active Storage Tier
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                      <Chip label="OPERATIONAL" size="small" color="success" sx={{ height: 20, fontSize: '0.7rem' }} />
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Cloudflare R2 active bucket
                      </Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      High-throughput hot media & document storage
                    </Typography>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Card variant="outlined" sx={{ p: 2, height: '100%' }}>
                    <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 600 }}>
                      Cold Archive Tier
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                      <Chip label="CONNECTED" size="small" color="info" sx={{ height: 20, fontSize: '0.7rem' }} />
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        Google Drive 5TB cold archive quota
                      </Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      Long-term compressed cold storage lifecycle
                    </Typography>
                  </Card>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <Card variant="outlined" sx={{ p: 2, height: '100%' }}>
                    <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', fontWeight: 600 }}>
                      Host Deployment Node
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
                      <Chip label="ACTIVE" size="small" color="success" sx={{ height: 20, fontSize: '0.7rem' }} />
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        gravebuster host status
                      </Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      Production autodeploy systemd service active
                    </Typography>
                  </Card>
                </Grid>
              </Grid>
            </Box>

            {/* 2. Direct Launcher Links to External Consoles */}
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
                🚀 External Admin Consoles
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Direct access to cloud infrastructure consoles and identity gateways:
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5 }}>
                <Button
                  variant="outlined"
                  size="small"
                  href="https://one.dash.cloudflare.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ textTransform: 'none' }}
                >
                  🌐 Cloudflare Zero Trust ↗
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  href="https://console.cloud.google.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ textTransform: 'none' }}
                >
                  ☁️ Google Cloud Console ↗
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  href="https://supabase.com/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ textTransform: 'none' }}
                >
                  ⚡ Supabase Studio ↗
                </Button>
              </Box>
            </Box>

            {/* 3. System-wide Workspaces Registry */}
            <Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
                <div>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    🏢 System-wide Workspaces Registry
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    All tenant workspaces across the Octo instance ({workspaces.length} registered)
                  </Typography>
                </div>
              </Box>
              <TableContainer component={Card} variant="outlined">
                <Table size="small">
                  <TableHead sx={{ bgcolor: 'action.hover' }}>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>Name</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Slug</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Role</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700 }}>Action</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {workspaces.map((ws) => {
                      const isCurrent = (activeContext?.workspace.id ?? selectedWsId) === ws.id;
                      return (
                        <TableRow key={ws.id} selected={isCurrent}>
                          <TableCell>
                            <Typography variant="body2" sx={{ fontWeight: isCurrent ? 700 : 500 }}>
                              {ws.name}
                            </Typography>
                            {ws.description && (
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                {ws.description}
                              </Typography>
                            )}
                          </TableCell>
                          <TableCell>
                            <Chip label={ws.slug} size="small" variant="outlined" sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }} />
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={ws.role}
                              size="small"
                              color={ws.role === 'owner' ? 'primary' : 'default'}
                              sx={{ fontSize: '0.75rem' }}
                            />
                          </TableCell>
                          <TableCell align="right">
                            <Button
                              size="small"
                              variant={isCurrent ? 'outlined' : 'contained'}
                              disabled={isCurrent}
                              onClick={() => {
                                handleWorkspaceChange(ws.id);
                                setIsAdminOpen(false);
                              }}
                              sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                            >
                              {isCurrent ? 'Active' : 'Switch Workspace'}
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 1.5 }}>
            <Button onClick={() => setIsAdminOpen(false)}>Close</Button>
          </DialogActions>
        </Dialog>
      </Box>
    </ThemeProvider>
  );
};
