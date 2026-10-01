/**
 * Octo Workspace Control Dashboard (Slices 1, 2, and 7)
 *
 * Polished control dashboard with Google sign-in, Guest login,
 * authorized workspace selector, file catalog (R2), and API key management.
 * Follows CGM visual direction guidelines (clear visual hierarchy, restrained palette,
 * consistent spacing, and expressive vector visuals).
 */

import React, { useState } from 'react';
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
  onCreateApiKey?: (name: string, isAccountWide: boolean) => Promise<{ rawSecret: string }>;
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
  onCreateApiKey,
  isLoading = false,
}) => {
  const [selectedWsId, setSelectedWsId] = useState<string>(
    activeContext?.workspace.id ?? workspaces[0]?.id ?? ''
  );
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyIsAccountWide, setNewKeyIsAccountWide] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

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
                            <TableCell sx={{ fontWeight: 600, width: '28%' }}>Name</TableCell>
                            <TableCell sx={{ fontWeight: 600, width: '12%' }}>Size</TableCell>
                            <TableCell sx={{ fontWeight: 600, width: '16%' }}>MIME Type</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>Storage Key</TableCell>
                            <TableCell sx={{ fontWeight: 600, width: '12%' }} align="right">
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
                              <TableCell
                                sx={{
                                  maxWidth: 260,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                                title={f.storageKey}
                              >
                                <code>{f.storageKey}</code>
                              </TableCell>
                              <TableCell align="right">
                                {onDeleteFile && activeContext.capabilities.canDeleteWorkspace && (
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    color="error"
                                    onClick={() => onDeleteFile(f.id)}
                                    sx={{ whiteSpace: 'nowrap' }}
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
      </Box>
    </ThemeProvider>
  );
};
