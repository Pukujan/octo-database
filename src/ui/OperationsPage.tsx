/**
 * Operations Page (Slice 6)
 *
 * Minimal operations view: job state, retry count, error summary, and recent
 * activity. Deliberately plain -- no charts or infrastructure controls beyond a
 * manual retry for a failed job.
 */

import React from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
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

const STATE_COLOR: Record<JobState, 'default' | 'info' | 'success' | 'error' | 'warning'> = {
  queued: 'default',
  running: 'info',
  completed: 'success',
  failed: 'error',
  paused: 'warning',
};

export const OperationsPage: React.FC<OperationsPageProps> = ({
  jobs,
  activity,
  onRetryJob,
  onRunWorker,
}) => {
  const failedCount = jobs.filter((j) => j.state === 'failed').length;
  const runningCount = jobs.filter((j) => j.state === 'running').length;
  const queuedCount = jobs.filter((j) => j.state === 'queued').length;

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'space-between',
          alignItems: { xs: 'flex-start', sm: 'center' },
          gap: 2,
          mb: 2,
        }}
      >
        <div>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            🛠️ Operations
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Background job state, retries, and recent activity for this workspace.
          </Typography>
        </div>
        {onRunWorker && (
          <Button variant="outlined" size="small" onClick={onRunWorker} sx={{ whiteSpace: 'nowrap' }}>
            Run worker pass
          </Button>
        )}
      </Box>

      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        <Chip label={`Queued: ${queuedCount}`} size="small" variant="outlined" />
        <Chip label={`Running: ${runningCount}`} size="small" color="info" variant="outlined" />
        <Chip
          label={`Failed: ${failedCount}`}
          size="small"
          color={failedCount > 0 ? 'error' : 'default'}
          variant="outlined"
        />
      </Box>

      <Card sx={{ mb: 3, borderRadius: 2 }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>
            Jobs
          </Typography>

          {jobs.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No jobs recorded yet for this workspace.
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, width: '18%' }}>Type</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: '14%' }}>State</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: '12%' }}>Attempts</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Error</TableCell>
                    <TableCell sx={{ fontWeight: 600, width: '14%' }} align="right">
                      Actions
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {jobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{job.jobType}</TableCell>
                      <TableCell>
                        <Chip label={job.state} size="small" color={STATE_COLOR[job.state]} />
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>
                        {job.attempt}/{job.maxAttempts}
                      </TableCell>
                      <TableCell sx={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {job.errorSummary ?? '—'}
                      </TableCell>
                      <TableCell align="right">
                        {onRetryJob && job.state === 'failed' && (
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            onClick={() => onRetryJob(job.id)}
                            sx={{ whiteSpace: 'nowrap' }}
                          >
                            Retry
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

      <Card sx={{ borderRadius: 2 }}>
        <CardContent>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>
            Activity
          </Typography>

          {activity.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No activity recorded yet.
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {activity.map((event) => (
                <Box key={event.id} sx={{ display: 'flex', gap: 1.5, alignItems: 'baseline' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                    {new Date(event.createdAt).toLocaleTimeString()}
                  </Typography>
                  <Typography variant="body2">{event.summary}</Typography>
                </Box>
              ))}
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};
