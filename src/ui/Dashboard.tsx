/**
 * Octo Workspace Control Dashboard (Slices 1, 2, and 7)
 *
 * Simple aesthetic control dashboard with Google sign-in, Guest login,
 * authorized workspace selector, file catalog (R2), and API key management.
 * Adheres to docs/UI_DIRECTION.md and owner instructions.
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
import { octoTheme } from './theme';

export interface DashboardProps {
  principal: Principal | null;
  workspaces: WorkspaceSummary[];
  activeContext: WorkspaceContext | null;
  files?: FileRecord[];
  apiKeys?: ApiKey[];
  onSignInWithGoogle: () => void;
  onSignInAsGuest?: () => void;
  onSignOut: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onUploadFile?: (name: string, mimeType: string, content: string) => Promise<void>;
  onDeleteFile?: (fileId: string) => Promise<void>;
  onCreateApiKey?: (name: string, isAccountWide: boolean) => Promise<{ rawSecret: string }>;
  isLoading?: boolean;
}

export const Dashboard: React.FC<DashboardProps> = ({
  principal,
  workspaces,
  activeContext,
  files = [],
  apiKeys = [],
  onSignInWithGoogle,
  onSignInAsGuest,
  onSignOut,
  onSelectWorkspace,
  onUploadFile,
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

  // 1. Unauthenticated View (Google Sign-In + Guest Login)
  if (!principal) {
    return (
      <ThemeProvider theme={octoTheme}>
        <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
          <AppBar position="static">
            <Toolbar>
              <Typography variant="h6" component="div" sx={{ flexGrow: 1, fontWeight: 700 }}>
                Octo
              </Typography>
            </Toolbar>
          </AppBar>

          <Container maxWidth="sm" sx={{ mt: 12, textAlign: 'center' }}>
            <Card sx={{ p: 4, borderRadius: 2 }}>
              <Typography variant="h5" gutterBottom sx={{ fontWeight: 700 }}>
                Welcome to Octo
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
                Access your personal control plane, workspaces, R2 storage catalog, and platform APIs.
              </Typography>

              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Button
                  variant="contained"
                  size="large"
                  fullWidth
                  onClick={onSignInWithGoogle}
                  disabled={isLoading}
                  sx={{ py: 1.5, textTransform: 'none', fontSize: '1rem' }}
                >
                  Sign in with Google
                </Button>

                {onSignInAsGuest && (
                  <Button
                    variant="outlined"
                    size="large"
                    fullWidth
                    onClick={onSignInAsGuest}
                    disabled={isLoading}
                    sx={{ py: 1.5, textTransform: 'none', fontSize: '1rem' }}
                  >
                    Continue as Guest
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
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        {/* Navigation Bar */}
        <AppBar position="static">
          <Toolbar sx={{ justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
                Octo
              </Typography>
              <Chip
                label="Control Plane"
                size="small"
                variant="outlined"
                sx={{ fontSize: '0.75rem', borderColor: 'divider' }}
              />
              {principal.isGuest && (
                <Chip
                  label="Guest Mode"
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
                  sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: '0.875rem' }}
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
                Select an authorized workspace to inspect files, active R2 storage, and API keys.
              </Typography>
            </div>

            {workspaces.length > 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  Active Workspace:
                </Typography>
                <Select
                  size="small"
                  value={selectedWsId || (workspaces[0]?.id ?? '')}
                  onChange={(e) => handleWorkspaceChange(e.target.value)}
                  sx={{ minWidth: 200, bgcolor: 'background.paper' }}
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
            <Card sx={{ p: 4, textAlign: 'center' }}>
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
              <Card sx={{ mb: 4, p: 1 }}>
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
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
                    <Typography variant="body2" sx={{ mb: 2 }}>
                      {activeContext.workspace.description}
                    </Typography>
                  )}

                  <Divider sx={{ my: 2 }} />

                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                    Workspace Capabilities:
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <Chip
                      label="Upload Files"
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
                    <Chip
                      label="Delete Workspace"
                      size="small"
                      variant={activeContext.capabilities.canDeleteWorkspace ? 'filled' : 'outlined'}
                      color={activeContext.capabilities.canDeleteWorkspace ? 'error' : 'default'}
                    />
                  </Box>
                </CardContent>
              </Card>

              {/* File Catalog (Slice 2) */}
              <Card sx={{ mb: 4 }}>
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <div>
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        File Catalog (Cloudflare R2)
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Active objects stored in private R2 bucket mapped to stable logical IDs.
                      </Typography>
                    </div>
                  </Box>

                  {files.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
                      No files uploaded yet in this workspace.
                    </Typography>
                  ) : (
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>Size</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>MIME Type</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>Storage Key</TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>Actions</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {files.map((f) => (
                            <TableRow key={f.id}>
                              <TableCell>{f.name}</TableCell>
                              <TableCell>{f.sizeBytes} B</TableCell>
                              <TableCell>{f.mimeType}</TableCell>
                              <TableCell><code>{f.storageKey}</code></TableCell>
                              <TableCell>
                                {onDeleteFile && activeContext.capabilities.canDeleteWorkspace && (
                                  <Button
                                    size="small"
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

              {/* API Keys (Account-Wide & Workspace-Scoped) */}
              <Card sx={{ mb: 4 }}>
                <CardContent>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <div>
                      <Typography variant="h6" sx={{ fontWeight: 700 }}>
                        API Keys (Account-Wide & Workspace-Scoped)
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Machine credentials for agents and external automation. Secrets are hashed with SHA-256.
                      </Typography>
                    </div>
                  </Box>

                  {/* Created Key Alert */}
                  {createdSecret && (
                    <Card sx={{ p: 2, mb: 2, bgcolor: '#f0fdf4', borderColor: '#86efac' }}>
                      <Typography variant="subtitle2" sx={{ color: '#166534', fontWeight: 600 }}>
                        New API Key Created (Copy Now - will not be displayed again):
                      </Typography>
                      <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', mt: 0.5 }}>
                        {createdSecret}
                      </Typography>
                    </Card>
                  )}

                  {/* Create Key Form */}
                  {onCreateApiKey && (
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 3 }}>
                      <TextField
                        size="small"
                        label="Key Name"
                        placeholder="e.g. Backup Agent"
                        value={newKeyName}
                        onChange={(e) => setNewKeyName(e.target.value)}
                        sx={{ minWidth: 220 }}
                      />
                      <Select
                        size="small"
                        value={newKeyIsAccountWide ? 'account' : 'workspace'}
                        onChange={(e) => setNewKeyIsAccountWide(e.target.value === 'account')}
                      >
                        <MenuItem value="workspace">Workspace-Scoped</MenuItem>
                        <MenuItem value="account">Account-Wide</MenuItem>
                      </Select>
                      <Button
                        variant="contained"
                        size="medium"
                        onClick={handleCreateKey}
                        disabled={!newKeyName.trim()}
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
                              <TableCell>{k.name}</TableCell>
                              <TableCell><code>{k.prefix}...</code></TableCell>
                              <TableCell>
                                <Chip
                                  label={k.isAccountWide ? 'Account-Wide' : 'Workspace-Scoped'}
                                  size="small"
                                  color={k.isAccountWide ? 'primary' : 'default'}
                                />
                              </TableCell>
                              <TableCell>{k.scopes.join(', ')}</TableCell>
                              <TableCell>{k.lastUsedAt ?? 'Never'}</TableCell>
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
            <Card sx={{ p: 3 }}>
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
