/** Workspace job status, recovery actions, and recent activity. */

import React from 'react';
import { Box, Button, Card, Chip, Divider, Typography } from '@mui/material';
import { JobState } from '../jobs/job-service';

export interface OperationsJob {
  id: string;
  jobType: string;
  state: JobState;
  attempt: number;
  maxAttempts: number;
  errorSummary: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface OperationsActivity {
  id: string;
  eventType: string;
  summary: string;
  createdAt: string;
}

export interface OperationsPageProps {
  jobs: OperationsJob[];
  activity: OperationsActivity[];
  onRetryJob?: (jobId: string) => void;
  onRunWorker?: () => void;
}

const STATE_TONE: Record<JobState, 'default' | 'info' | 'success' | 'error' | 'warning'> = {
  queued: 'default',
  running: 'info',
  completed: 'success',
  failed: 'error',
  paused: 'warning',
};

const formatDate = (value: string) =>
  new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export const OperationsPage: React.FC<OperationsPageProps> = ({
  jobs,
  activity,
  onRetryJob,
  onRunWorker,
}) => {
  const failed = jobs.filter((job) => job.state === 'failed');
  const queued = jobs.filter((job) => job.state === 'queued');
  const otherJobs = jobs
    .filter((job) => job.state !== 'failed')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'space-between',
          alignItems: { xs: 'flex-start', sm: 'flex-end' },
          gap: 2,
          mb: 3,
        }}
      >
        <Box>
          <Typography variant="overline" sx={{ color: 'text.secondary', letterSpacing: '.14em' }}>
            Workspace activity
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 650, letterSpacing: '-.035em', lineHeight: 1.15 }}>
            Operations
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            Follow background work and pick up anything that needs a retry.
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
            Queued: {queued.length} · Failed: {failed.length}
          </Typography>
        </Box>
        {onRunWorker && (
          <Button
            variant="outlined"
            onClick={onRunWorker}
            sx={{ borderRadius: 2, px: 2, whiteSpace: 'nowrap' }}
          >
            Run worker pass
          </Button>
        )}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.55fr) minmax(280px, .85fr)' }, gap: 2 }}>
        <Card
          variant="outlined"
          sx={(theme) => ({
            borderRadius: 2.5,
            borderColor: 'divider',
            boxShadow: 'none',
            bgcolor: theme.palette.mode === 'dark' ? 'background.paper' : '#fff',
          })}
        >
          <Box sx={{ px: 2.25, py: 1.9, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
            <Box>
              <Typography sx={{ fontWeight: 650 }}>Job queue</Typography>
              <Typography variant="caption" color="text.secondary">Recent work in this workspace</Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">{jobs.length} total</Typography>
          </Box>
          <Divider />

          {failed.length > 0 ? (
            <Box sx={{ px: 2.25, pt: 2.25, pb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <Box aria-hidden="true" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'error.main' }} />
                <Typography variant="subtitle2" sx={{ fontWeight: 650 }}>Needs attention</Typography>
                <Chip label={failed.length} size="small" color="error" sx={{ height: 21 }} />
              </Box>
              <Box sx={{ display: 'grid', gap: 1 }}>
                {failed.map((job) => (
                  <Box
                    key={job.id}
                    sx={(theme) => ({
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: { xs: 'flex-start', sm: 'center' },
                      flexDirection: { xs: 'column', sm: 'row' },
                      gap: 1.5,
                      p: 1.75,
                      borderRadius: 2,
                      border: '1px solid',
                      borderColor: theme.palette.mode === 'dark' ? 'rgba(248,113,113,.28)' : 'rgba(185,28,28,.2)',
                      bgcolor: theme.palette.mode === 'dark' ? 'rgba(127,29,29,.13)' : 'rgba(254,242,242,.8)',
                    })}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.4 }}>
                        <Typography sx={{ fontWeight: 600 }}>{job.jobType}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          Attempt {job.attempt} of {job.maxAttempts}
                        </Typography>
                      </Box>
                      <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                        {job.errorSummary || 'This job failed without an error summary.'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                        Started {formatDate(job.createdAt)}
                      </Typography>
                    </Box>
                    {onRetryJob && (
                      <Button
                        variant="contained"
                        color="error"
                        size="small"
                        onClick={() => onRetryJob(job.id)}
                        sx={{ borderRadius: 1.5, flexShrink: 0, px: 1.75 }}
                      >
                        Retry job
                      </Button>
                    )}
                  </Box>
                ))}
              </Box>
              {otherJobs.length > 0 && <Divider sx={{ mt: 2 }} />}
            </Box>
          ) : (
            <Box sx={{ px: 2.25, py: 2 }}>
              <Box
                sx={(theme) => ({
                  px: 1.75,
                  py: 1.5,
                  borderRadius: 2,
                  bgcolor: theme.palette.mode === 'dark' ? 'rgba(34,197,94,.08)' : 'rgba(240,253,244,.9)',
                  border: '1px solid',
                  borderColor: theme.palette.mode === 'dark' ? 'rgba(34,197,94,.18)' : 'rgba(22,163,74,.16)',
                })}
              >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>All clear</Typography>
                <Typography variant="caption" color="text.secondary">No jobs need a retry right now.</Typography>
              </Box>
            </Box>
          )}

          {otherJobs.length === 0 ? (
            <Box sx={{ px: 2.25, py: 2.5 }}>
              <Typography variant="body2" color="text.secondary">
                {jobs.length === 0 ? 'No jobs have been recorded for this workspace.' : 'No other recent jobs.'}
              </Typography>
            </Box>
          ) : (
            <Box>
              {otherJobs.map((job, index) => (
                <Box key={job.id}>
                  {index > 0 && <Divider />}
                  <Box sx={{ px: 2.25, py: 1.4, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 550 }} noWrap>{job.jobType}</Typography>
                      <Typography variant="caption" color="text.secondary">{formatDate(job.createdAt)}</Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                      {job.attempt}/{job.maxAttempts} attempts
                    </Typography>
                    <Chip label={job.state} size="small" color={STATE_TONE[job.state]} sx={{ minWidth: 76 }} />
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </Card>

        <Card
          variant="outlined"
          sx={(theme) => ({
            borderRadius: 2.5,
            borderColor: 'divider',
            boxShadow: 'none',
            bgcolor: theme.palette.mode === 'dark' ? 'background.paper' : '#fff',
            alignSelf: 'start',
          })}
        >
          <Box sx={{ px: 2.25, py: 1.9 }}>
            <Typography sx={{ fontWeight: 650 }}>Recent activity</Typography>
            <Typography variant="caption" color="text.secondary">What changed and when</Typography>
          </Box>
          <Divider />
          {activity.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ px: 2.25, py: 2.5 }}>
              Activity will appear here as work happens.
            </Typography>
          ) : (
            <Box sx={{ px: 2.25, py: 1.25 }}>
              {activity.map((event, index) => (
                <Box key={event.id} sx={{ display: 'grid', gridTemplateColumns: '12px minmax(0, 1fr)', gap: 1.25 }}>
                  <Box sx={{ position: 'relative', display: 'flex', justifyContent: 'center', pt: 0.55 }}>
                    <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: index === 0 ? 'primary.main' : 'text.disabled' }} />
                    {index < activity.length - 1 && (
                      <Box sx={{ position: 'absolute', top: 12, bottom: 0, width: '1px', bgcolor: 'divider' }} />
                    )}
                  </Box>
                  <Box sx={{ pb: 2.1, minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.35 }}>
                      {formatDate(event.createdAt)} · {event.eventType}
                    </Typography>
                    <Typography variant="body2" sx={{ lineHeight: 1.45, overflowWrap: 'anywhere' }}>
                      {event.summary}
                    </Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </Card>
      </Box>
    </Box>
  );
};
