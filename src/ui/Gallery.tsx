/**
 * Octo Workspace Gallery (Slice 3)
 *
 * Polished visual grid for workspace images and videos with responsive lightbox viewer.
 * Follows CGM visual direction guidelines (restrained density, clear focal points, accessible contrast).
 */

import React, { useState } from 'react';
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  CardMedia,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  Typography,
} from '@mui/material';
import { GalleryItem } from '../media/gallery-service';

export interface GalleryProps {
  items: GalleryItem[];
  workspaceName?: string;
}

export const Gallery: React.FC<GalleryProps> = ({ items, workspaceName }) => {
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null);

  const imagesCount = items.filter((i) => i.kind === 'image').length;
  const videosCount = items.filter((i) => i.kind === 'video').length;

  return (
    <Box sx={{ py: 2 }}>
      {/* Gallery Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <div>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            🖼️ {workspaceName ? `${workspaceName} Gallery` : 'Workspace Gallery'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {items.length === 0
              ? 'No media items uploaded yet in this workspace.'
              : `${imagesCount} photo${imagesCount === 1 ? '' : 's'}, ${videosCount} video${videosCount === 1 ? '' : 's'}`}
          </Typography>
        </div>
      </Box>

      {/* Empty State */}
      {items.length === 0 ? (
        <Card sx={{ p: 4, textAlign: 'center', bgcolor: 'background.paper', borderRadius: 2 }}>
          <Typography variant="body1" sx={{ fontWeight: 500, mb: 1 }}>
            Gallery is empty
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Upload images (JPEG, PNG, WebP) or videos (MP4, WebM) to see them displayed here.
          </Typography>
        </Card>
      ) : (
        /* Responsive Media Grid */
        <Grid container spacing={2}>
          {items.map((item) => (
            <Grid item xs={12} sm={6} md={4} lg={3} key={item.id}>
              <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column', borderRadius: 2 }}>
                <CardActionArea onClick={() => setSelectedItem(item)}>
                  {item.kind === 'image' ? (
                    <CardMedia
                      component="img"
                      height="180"
                      image={item.thumbnailUrl}
                      alt={item.name}
                      sx={{ objectFit: 'cover', bgcolor: '#f1f5f9' }}
                    />
                  ) : (
                    <Box
                      sx={{
                        height: 180,
                        bgcolor: '#0f172a',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#ffffff',
                      }}
                    >
                      <Typography sx={{ fontSize: 36, mb: 1 }}>▶️</Typography>
                      <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                        Video Preview
                      </Typography>
                    </Box>
                  )}
                  <CardContent sx={{ p: 1.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                      <Typography
                        variant="body2"
                        noWrap
                        sx={{ fontWeight: 600, maxWidth: 160 }}
                        title={item.name}
                      >
                        {item.name}
                      </Typography>
                      <Chip
                        label={item.kind === 'video' ? 'VIDEO' : 'PHOTO'}
                        size="small"
                        color={item.kind === 'video' ? 'secondary' : 'primary'}
                        sx={{ fontSize: '0.65rem', height: 20 }}
                      />
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                      {(item.sizeBytes / 1024).toFixed(1)} KB
                    </Typography>
                  </CardContent>
                </CardActionArea>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Lightbox Modal Dialog */}
      <Dialog
        open={Boolean(selectedItem)}
        onClose={() => setSelectedItem(null)}
        maxWidth="md"
        fullWidth
      >
        {selectedItem && (
          <>
            <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2 }}>
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  {selectedItem.name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {selectedItem.mimeType} • {(selectedItem.sizeBytes / 1024).toFixed(1)} KB
                </Typography>
              </Box>
              <IconButton onClick={() => setSelectedItem(null)} size="small" aria-label="close">
                ✕
              </IconButton>
            </DialogTitle>
            <DialogContent sx={{ p: 0, bgcolor: '#000000', display: 'flex', justifyContent: 'center' }}>
              {selectedItem.kind === 'image' ? (
                <Box
                  component="img"
                  src={selectedItem.fullUrl}
                  alt={selectedItem.name}
                  sx={{
                    maxHeight: '75vh',
                    maxWidth: '100%',
                    objectFit: 'contain',
                  }}
                />
              ) : (
                <Box
                  component="video"
                  controls
                  autoPlay
                  src={selectedItem.fullUrl}
                  sx={{
                    maxHeight: '75vh',
                    maxWidth: '100%',
                  }}
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
