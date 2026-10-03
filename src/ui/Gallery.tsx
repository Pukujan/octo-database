/** Workspace media gallery with an image-led grid and focused viewer. */

import React, { useState } from 'react';
import {
  Box,
  CardActionArea,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from '@mui/material';
import { GalleryItem } from '../media/gallery-service';

export interface GalleryProps {
  items: GalleryItem[];
  workspaceName?: string;
}

const formatSize = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export const Gallery: React.FC<GalleryProps> = ({ items, workspaceName }) => {
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null);
  const photos = items.filter((item) => item.kind === 'image').length;
  const videos = items.length - photos;

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: { xs: 'flex-start', sm: 'flex-end' },
          justifyContent: 'space-between',
          flexDirection: { xs: 'column', sm: 'row' },
          gap: 1.5,
          mb: 3,
        }}
      >
        <Box>
          <Typography variant="overline" sx={{ color: 'text.secondary', letterSpacing: '.14em' }}>
            Workspace media
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 650, letterSpacing: '-.035em', lineHeight: 1.15 }}>
            {workspaceName ? `${workspaceName} gallery` : 'Gallery'}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary">
          {items.length === 0
            ? 'A home for the images and videos in this workspace.'
            : `${items.length} items · ${photos} photos · ${videos} videos`}
        </Typography>
      </Box>

      {items.length === 0 ? (
        <Box
          sx={(theme) => ({
            minHeight: 220,
            display: 'grid',
            placeItems: 'center',
            textAlign: 'center',
            px: 3,
            border: '1px dashed',
            borderColor: 'divider',
            borderRadius: 3,
            bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,.025)' : 'rgba(15,23,42,.018)',
          })}
        >
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>
              Nothing here yet
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Images and videos added to this workspace will show up here.
            </Typography>
          </Box>
        </Box>
      ) : (
        <Box
          sx={{
            columns: { xs: 1, sm: 2, lg: 3 },
            columnGap: { xs: 1.5, sm: 2 },
            '& > *': { breakInside: 'avoid', mb: { xs: 1.5, sm: 2 } },
          }}
        >
          {items.map((item, index) => (
            <Box
              key={item.id}
              sx={(theme) => ({
                overflow: 'hidden',
                borderRadius: 2.5,
                bgcolor: theme.palette.background.paper,
                border: '1px solid',
                borderColor: 'divider',
                transition: 'transform 180ms ease, border-color 180ms ease',
                '&:hover': {
                  transform: 'translateY(-2px)',
                  borderColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,.3)' : 'rgba(15,23,42,.26)',
                },
              })}
            >
              <CardActionArea
                onClick={() => setSelectedItem(item)}
                aria-label={`Open ${item.kind}: ${item.name}`}
                sx={{ display: 'block', textAlign: 'left' }}
              >
                <Box
                  sx={{
                    position: 'relative',
                    overflow: 'hidden',
                    aspectRatio: item.kind === 'video' ? '4 / 3' : index % 5 === 1 ? '4 / 5' : '4 / 3',
                    bgcolor: 'action.hover',
                    '& img': { transition: 'transform 350ms ease' },
                    '&:hover img': { transform: 'scale(1.035)' },
                  }}
                >
                  {item.kind === 'image' ? (
                    <Box
                      component="img"
                      src={item.thumbnailUrl}
                      alt={item.name}
                      loading="lazy"
                      sx={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }}
                    />
                  ) : (
                    <Box
                      sx={(theme) => ({
                        height: '100%',
                        display: 'grid',
                        placeItems: 'center',
                        background: theme.palette.mode === 'dark'
                          ? 'linear-gradient(145deg, #253347, #111821 72%)'
                          : 'linear-gradient(145deg, #dbe5ec, #9aabb8 72%)',
                      })}
                    >
                      <Box
                        aria-hidden="true"
                        sx={{
                          width: 52,
                          height: 52,
                          display: 'grid',
                          placeItems: 'center',
                          borderRadius: '50%',
                          color: '#fff',
                          bgcolor: 'rgba(8,15,23,.64)',
                          backdropFilter: 'blur(8px)',
                          '&::after': {
                            content: '""',
                            width: 0,
                            height: 0,
                            ml: '4px',
                            borderTop: '7px solid transparent',
                            borderBottom: '7px solid transparent',
                            borderLeft: '10px solid currentColor',
                          },
                        }}
                      />
                      <Typography
                        variant="caption"
                        sx={{ position: 'absolute', bottom: 12, left: 14, color: 'rgba(255,255,255,.85)' }}
                      >
                        VIDEO
                      </Typography>
                    </Box>
                  )}
                  {item.kind === 'image' && (
                    <Typography
                      variant="caption"
                      sx={{
                        position: 'absolute',
                        left: 12,
                        bottom: 10,
                        px: 1,
                        py: 0.35,
                        borderRadius: 1,
                        color: '#fff',
                        bgcolor: 'rgba(8,15,23,.58)',
                        backdropFilter: 'blur(8px)',
                      }}
                    >
                      PHOTO
                    </Typography>
                  )}
                </Box>
                <Box sx={{ px: 1.5, py: 1.35 }}>
                  <Typography title={item.name} noWrap sx={{ fontSize: '.9rem', fontWeight: 550 }}>
                    {item.name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatSize(item.sizeBytes)}
                  </Typography>
                </Box>
              </CardActionArea>
            </Box>
          ))}
        </Box>
      )}

      <Dialog
        open={Boolean(selectedItem)}
        onClose={() => setSelectedItem(null)}
        maxWidth="xl"
        fullWidth
        PaperProps={{
          sx: (theme) => ({
            overflow: 'hidden',
            borderRadius: 3,
            bgcolor: theme.palette.mode === 'dark' ? '#10151b' : '#111820',
            color: '#f6f8fa',
          }),
        }}
      >
        {selectedItem && (
          <>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, py: 1.75, px: 2.5 }}>
              <Box sx={{ minWidth: 0 }}>
                <Typography noWrap sx={{ fontSize: '.95rem', fontWeight: 600 }}>
                  {selectedItem.name}
                </Typography>
                <Typography variant="caption" sx={{ color: 'rgba(246,248,250,.64)' }}>
                  {selectedItem.mimeType} · {formatSize(selectedItem.sizeBytes)}
                </Typography>
              </Box>
              <IconButton
                onClick={() => setSelectedItem(null)}
                aria-label="Close viewer"
                sx={{ color: 'inherit', border: '1px solid rgba(255,255,255,.18)', borderRadius: 1.5 }}
              >
                <Box component="span" sx={{ fontSize: 22, lineHeight: 1, fontWeight: 300 }}>×</Box>
              </IconButton>
            </DialogTitle>
            <DialogContent
              sx={{
                p: { xs: 1.5, sm: 2 },
                minHeight: { xs: 240, sm: 420 },
                display: 'grid',
                placeItems: 'center',
                bgcolor: '#080b0f',
              }}
            >
              {selectedItem.kind === 'image' ? (
                <Box
                  component="img"
                  src={selectedItem.fullUrl}
                  alt={selectedItem.name}
                  sx={{ maxHeight: '78vh', maxWidth: '100%', objectFit: 'contain' }}
                />
              ) : (
                <Box
                  component="video"
                  controls
                  autoPlay
                  src={selectedItem.fullUrl}
                  sx={{ maxHeight: '78vh', maxWidth: '100%' }}
                >
                  Your browser does not support video playback.
                </Box>
              )}
            </DialogContent>
          </>
        )}
      </Dialog>
    </Box>
  );
};
