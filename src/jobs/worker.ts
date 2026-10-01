/**
 * Background Worker (Slice 6)
 *
 * One worker process claims queued jobs with a lease, runs the handler, and
 * records the outcome. Two properties are load-bearing:
 *
 *   - Idempotent side effects: each handler is keyed by the job's identity, so
 *     re-running a job after a crash converges to the same result instead of
 *     producing a duplicate.
 *   - Lease-based recovery: a worker that dies mid-job stops renewing its lease,
 *     and the job becomes claimable again once the lease expires.
 */

import { ObjectStore } from '../storage/object-store';
import { ensureThumbnail } from '../media/thumbnail-service';
import { ClaimedJob, completeJob, failJob, recordActivity } from './job-service';

export interface WorkerDeps {
  /** Claims the next runnable job, or null when the queue is empty. */
  claim: () => Promise<ClaimedJob | null>;
  store: ObjectStore;
  /** Completes a job with a result payload. */
  complete: (jobId: string, result: Record<string, unknown>) => Promise<void>;
  fail: (
    job: ClaimedJob,
    errorCode: string,
    errorSummary: string,
    retryable: boolean
  ) => Promise<void>;
  activity: (job: ClaimedJob, summary: string) => Promise<void>;
  log?: (message: string) => void;
}

export interface JobOutcome {
  jobId: string;
  status: 'completed' | 'failed' | 'retry';
  detail: string;
}

/**
 * Handles a thumbnail job. Idempotency comes from the stable derivative key:
 * re-running regenerates or reuses `derived/{fileId}/thumb.webp` rather than
 * creating a second artifact.
 */
export async function handleThumbnailJob(
  job: ClaimedJob,
  store: ObjectStore
): Promise<{ ok: true; detail: string } | { ok: false; code: string; summary: string }> {
  const fileId = job.payload['fileId'];
  const storageKey = job.payload['storageKey'];
  const mimeType = job.payload['mimeType'];

  if (typeof fileId !== 'string' || typeof storageKey !== 'string' || typeof mimeType !== 'string') {
    // Malformed payload will never succeed on retry.
    return { ok: false, code: 'INVALID_PAYLOAD', summary: 'Job payload is missing fileId, storageKey, or mimeType' };
  }

  const thumb = await ensureThumbnail(store, fileId, storageKey, mimeType);
  if (!thumb) {
    return { ok: false, code: 'NO_DERIVATIVE', summary: `No thumbnail produced for ${fileId}` };
  }

  return { ok: true, detail: `thumbnail ${thumb.cached ? 'reused' : 'generated'} (${thumb.bytes.byteLength} bytes)` };
}

/** Runs a single claimed job through its handler and records the outcome. */
export async function processJob(job: ClaimedJob, deps: WorkerDeps): Promise<JobOutcome> {
  try {
    let outcome: { ok: true; detail: string } | { ok: false; code: string; summary: string };

    if (job.jobType === 'thumbnail') {
      outcome = await handleThumbnailJob(job, deps.store);
    } else {
      outcome = { ok: false, code: 'UNKNOWN_JOB_TYPE', summary: `No handler for job type ${job.jobType}` };
    }

    if (outcome.ok) {
      await deps.complete(job.jobId, { detail: outcome.detail, attempt: job.attempt });
      await deps.activity(job, `Job ${job.jobType} completed: ${outcome.detail}`);
      return { jobId: job.jobId, status: 'completed', detail: outcome.detail };
    }

    // INVALID_PAYLOAD and UNKNOWN_JOB_TYPE are deterministic: retrying cannot help.
    const retryable = outcome.code !== 'INVALID_PAYLOAD' && outcome.code !== 'UNKNOWN_JOB_TYPE';
    await deps.fail(job, outcome.code, outcome.summary, retryable);
    await deps.activity(job, `Job ${job.jobType} ${retryable ? 'failed, will retry' : 'failed permanently'}: ${outcome.summary}`);
    return { jobId: job.jobId, status: retryable ? 'retry' : 'failed', detail: outcome.summary };
  } catch (err: unknown) {
    const summary = err instanceof Error ? err.message : String(err);
    await deps.fail(job, 'HANDLER_EXCEPTION', summary, true);
    await deps.activity(job, `Job ${job.jobType} threw: ${summary}`);
    return { jobId: job.jobId, status: 'retry', detail: summary };
  }
}

/**
 * Drains the queue once. Returns the outcomes so callers (including tests and the
 * failure drill) can assert exactly what happened.
 */
export async function drainQueue(deps: WorkerDeps, maxJobs = 25): Promise<JobOutcome[]> {
  const outcomes: JobOutcome[] = [];

  for (let i = 0; i < maxJobs; i += 1) {
    const job = await deps.claim();
    if (!job) break;
    outcomes.push(await processJob(job, deps));
  }

  return outcomes;
}

/**
 * Builds worker dependencies backed by a Supabase client.
 * Kept here so both the long-running worker and tests share one wiring.
 */
export function buildWorkerDeps(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  store: ObjectStore,
  log: (message: string) => void = console.log
): WorkerDeps {
  return {
    claim: async () => {
      const { data, error } = await supabase
        .schema('octo')
        .rpc('claim_job', { target_worker: 'octo-worker-1', lease_seconds: 60 });
      if (error || !data) return null;
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return null;
      return {
        jobId: row.job_id,
        workspaceId: row.workspace_id,
        jobType: row.job_type,
        attempt: Number(row.attempt),
        payload: row.payload ?? {},
      };
    },
    store,
    complete: (jobId, result) => completeJob(supabase, jobId, result),
    fail: async (job, code, summary, retryable) => {
      await failJob(supabase, job.jobId, job.attempt, 3, code, summary, retryable);
    },
    activity: (job, summary) =>
      recordActivity(supabase, job.workspaceId, 'job.transition', summary, { jobId: job.jobId }),
    log,
  };
}
