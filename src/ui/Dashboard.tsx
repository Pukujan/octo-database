/**
 * Octo Workspace Control Dashboard (Slice 1)
 *
 * Simple aesthetic control dashboard with Google sign-in, authorized workspace
 * selector, and workspace entry.
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
  ThemeProvider,
  Toolbar,
  Typography,
} from '@mui/material';
import { Principal, WorkspaceRole, WorkspaceSummary } from '../types/auth';
import { WorkspaceContext } from '../auth/workspace-service';
import { octoTheme } from './theme';

export interface DashboardProps {
  principal: Principal | null;
  workspaces: WorkspaceSummary[];
  activeContext: WorkspaceContext | null;
  onSignInWithGoogle: () => void;
  onSignOut: () => void;
  onSelectWorkspace: (workspaceId: string) => void;
  isLoading?: boolean;
}

export const Dashboard: React.FC<DashboardProps> = ({
  principal,
  workspaces,
  activeContext,
  onSignInWithGoogle,
  onSignOut,
  onSelectWorkspace,
  isLoading = false,
}) => {
  const [selectedWsId, setSelectedWsId] = useState<string>(
    activeContext?.workspace.id ?? workspaces[0]?.id ?? ''
  );

  const handleWorkspaceChange = (newId: string) => {
    setSelectedWsId(newId);
    onSelectWorkspace(newId);
  };

  // 1. Unauthenticated View
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
                Sign in with your Google account to access your personal control plane and authorized workspaces.
              </Typography>
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
                Select an authorized workspace to enter and inspect storage and platform capabilities.
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
                Contact the platform administrator to be added.
              </Typography>
            </Card>
          ) : activeContext ? (
            /* Active Workspace View */
            <Box>
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

              {/* Downstream Slice Cards (Files #4, Gallery #5, Operations #8) */}
              <Grid container spacing={3}>
                <Grid item xs={12} md={4}>
                  <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <CardContent sx={{ flexGrow: 1 }}>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
                        File Catalog
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Active R2 object storage backed by one platform API (Slice 2, #4).
                      </Typography>
                    </CardContent>
                    <CardActions sx={{ p: 2, pt: 0 }}>
                      <Button size="small" disabled>
                        Browse Files
                      </Button>
                    </CardActions>
                  </Card>
                </Grid>

                <Grid item xs={12} md={4}>
                  <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <CardContent sx={{ flexGrow: 1 }}>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
                        Gallery
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Simple workspace image and video grid with responsive viewer (Slice 3, #5).
                      </Typography>
                    </CardContent>
                    <CardActions sx={{ p: 2, pt: 0 }}>
                      <Button size="small" disabled>
                        Open Gallery
                      </Button>
                    </CardActions>
                  </Card>
                </Grid>

                <Grid item xs={12} md={4}>
                  <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                    <CardContent sx={{ flexGrow: 1 }}>
                      <Typography variant="h6" sx={{ fontWeight: 600, mb: 1 }}>
                        Operations
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Job status, activity logs, and system health oversight (Slice 6, #8).
                      </Typography>
                    </CardContent>
                    <CardActions sx={{ p: 2, pt: 0 }}>
                      <Button size="small" disabled>
                        View Jobs
                      </Button>
                    </CardActions>
                  </Card>
                </Grid>
              </Grid>
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
