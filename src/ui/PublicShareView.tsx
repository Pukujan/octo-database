/**
 * Public Share Viewer (Slice 4)
 *
 * Standalone read-only gallery for a scoped share link. It has no session, no
 * workspace switcher, no admin controls, and no API-key surface: the token in the
 * URL is the entire capability.
 */

import React, { useEffect, useState } from 'react';
import { Box, Chip, Container, ThemeProvider, Typography } from '@mui/material';
import { octoTheme } from './theme';
import { GalleryItem } from '../media/gallery-service';
import { Gallery } from './Gallery';

interface ShareInfo {
  id: string;
  resourceType: string;
  permission: string;
  validUntil: string | null;
}

interface PublicShareViewProps {
  token: string;
}

export const PublicShareView: React.FC<PublicShareViewProps> = ({ token }) => {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [share, setShare] = useState<ShareInfo | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/public/shares/${encodeURIComponent(token)}`);
        if (!res.ok) {
          setState('unavailable');
          return;
        }
        const data = await res.json();
        setShare(data.share);
        setItems(data.items ?? []);
        setState('ready');
      } catch {
        setState('unavailable');
      }
    }
    load();
  }, [token]);

  return (
    <ThemeProvider theme={octoTheme}>
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default', py: 4 }}>
        <Container maxWidth="lg">
          <Box sx={{ mb: 3 }}>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              🐙 Shared Album
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Read-only view of a single shared album.
            </Typography>
          </Box>

          {state === 'loading' && (
            <Typography variant="body2" color="text.secondary">
              Loading shared album…
            </Typography>
          )}

          {state === 'unavailable' && (
            <Box sx={{ py: 6, textAlign: 'center' }}>
              <Typography variant="h6" sx={{ mb: 1 }}>
                This link is not available
              </Typography>
              <Typography variant="body2" color="text.secondary">
                It may have been revoked, expired, or never existed.
              </Typography>
            </Box>
          )}

          {state === 'ready' && share && (
            <>
              <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                <Chip label={`Permission: ${share.permission}`} size="small" color="primary" />
                <Chip
                  label={share.validUntil ? `Expires ${share.validUntil}` : 'No expiry (revocable)'}
                  size="small"
                  variant="outlined"
                />
              </Box>
              <Gallery items={items} workspaceName="Shared" />
            </>
          )}
        </Container>
      </Box>
    </ThemeProvider>
  );
};
