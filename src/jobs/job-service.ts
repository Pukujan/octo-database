/**
 * Job Queue (Slice 6)
 *
 * Durable, Postgres-backed background work. Two invariants matter:
 *
 *   1. Idempotency: enqueueing with the same key in the same workspace and type
 *      returns the existing job instead of creating a second logical unit.
 *   2. Crash convergence: a worker that dies mid-job leaves a lease that expires,
 *      so the job becomes claimable again rather than being lost or duplicated.
 */

import { randomUUID } from 'crypto';
import { SupabaseClient } from '@supabase/supabase-js';
import { Principal } from '../types/auth';

export type JobState = 'queued' | 'running' | 'completed' | 'failed' | 'paused';

export interface JobRecord {
  id: string;
  workspaceId: string;
  jobType: string;
  state: JobState;
  idempotencyKey: string;
  attempt: number;
  maxAttempts: number;
  availableAt: string;
  leaseExpiresAt: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  errorCode: string | null;
  errorSummary: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnqueueJobInput {
  workspaceId: string;
  jobType: string;
  /** Repeat calls with the same key return the original job. */
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
}

export interface ClaimedJob {
  jobId: string;
  workspaceId: string;
  jobType: string;
  attempt: number;
  payload: Record<string, unknown>;
}

/** Terminal states never transition again. */
export function isTerminal(state: JobState): boolean {
  return state === 'completed' || state === 'failed';
}

/** Legal transitions for the job state machine. */
export const ALLOWED_TRANSITIONS: Record<JobState, JobState[]> = {
  queued: ['running', 'paused', 'failed'],
  running: ['completed', 'failed', 'queued'],
  completed: [],
  failed: ['queued'],
  paused: ['queued'],
};

export function canTransition(from: JobState, to: JobState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Enqueues a job, returning the existing row when the idempotency key was
 * already used for this workspace and type.
 */
export async function enqueueJob(
  supabase: SupabaseClient,
  principal: Principal,
  input: EnqueueJobInput
): Promise<{ job: JobRecord; created: boolean }> {
  const now = new Date().toISOString();
  const row = {
    id: randomUUID(),
    workspace_id: input.workspaceId,
    job_type: input.jobType,
    state: 'queued',
    idempotency_key: input.idempotencyKey,
    max_attempts: input.maxAttempts ?? 3,
    payload: input.payload ?? {},
    created_by: principal.id,
    created_at: now,
    updated_at: now,
  };

  const { data, error } = await supabase
    .schema('octo')
    .from('jobs')
    .insert(row)
    .select('*')
    .single();

  if (!error && data) {
    return { job: mapJobRow(data), created: true };
  }

  // Unique violation means the key already exists: return the original job.
  const { data: existing } = await supabase
    .schema('octo')
    .from('jobs')
    .select('*')
    .eq('workspace_id', input.workspaceId)
    .eq('job_type', input.jobType)
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();

  if (existing) {
    return { job: mapJobRow(existing), created: false };
  }

  throw new Error(`JOB_ENQUEUE_FAILED: ${error?.message ?? 'Unknown error'}`);
}

/** Lists jobs for a workspace, newest first. */
export async function listJobs(
  supabase: SupabaseClient,
  workspaceId: string,
  limit = 50
): Promise<JobRecord[]> {
  const { data, error } = await supabase
    .schema('octo')
    .from('jobs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`JOB_LIST_FAILED: ${error.message}`);
  if (!data) return [];
  return data.map(mapJobRow);
}

/** Marks a job complete. Only the first completion for a job is meaningful. */
export async function completeJob(
  supabase: SupabaseClient,
  jobId: string,
  result: Record<string, unknown> = {}
): Promise<void> {
  const { error } = await supabase
    .schema('octo')
    .from('jobs')
    .update({
      state: 'completed',
      result,
      completed_at: new Date().toISOString(),
      lease_expires_at: null,
      lease_owner: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .eq('state', 'running');

  if (error) throw new Error(`JOB_COMPLETE_FAILED: ${error.message}`);
}

/**
 * Records a failure. Retryable failures requeue with backoff until max_attempts
 * is reached; non-retryable failures terminate immediately.
 */
export async function failJob(
  supabase: SupabaseClient,
  jobId: string,
  attempt: number,
  maxAttempts: number,
  errorCode: string,
  errorSummary: string,
  retryable = true
): Promise<{ state: JobState; nextAvailableAt: string | null }> {
  const exhausted = attempt >= maxAttempts;
  const now = new Date();

  if (!retryable || exhausted) {
    const { error } = await supabase
      .schema('octo')
      .from('jobs')
      .update({
        state: 'failed',
        error_code: errorCode,
        error_summary: errorSummary,
        completed_at: now.toISOString(),
        lease_expires_at: null,
        lease_owner: null,
        updated_at: now.toISOString(),
      })
      .eq('id', jobId);

    if (error) throw new Error(`JOB_FAIL_FAILED: ${error.message}`);
    return { state: 'failed', nextAvailableAt: null };
  }

  // Exponential backoff: 2^attempt seconds, capped at 5 minutes.
  const backoffSeconds = Math.min(2 ** attempt, 300);
  const nextAvailableAt = new Date(now.getTime() + backoffSeconds * 1000).toISOString();

  const { error } = await supabase
    .schema('octo')
    .from('jobs')
    .update({
      state: 'queued',
      error_code: errorCode,
      error_summary: errorSummary,
      available_at: nextAvailableAt,
      lease_expires_at: null,
      lease_owner: null,
      updated_at: now.toISOString(),
    })
    .eq('id', jobId);

  if (error) throw new Error(`JOB_REQUEUE_FAILED: ${error.message}`);
  return { state: 'queued', nextAvailableAt };
}

/** Records a human-readable activity event. Never store secrets here. */
export async function recordActivity(
  supabase: SupabaseClient,
  workspaceId: string,
  eventType: string,
  summary: string,
  options: { jobId?: string; actorPrincipalId?: string; detail?: Record<string, unknown> } = {}
): Promise<void> {
  const { error } = await supabase.schema('octo').from('activity').insert({
    workspace_id: workspaceId,
    job_id: options.jobId ?? null,
    actor_principal_id: options.actorPrincipalId ?? null,
    event_type: eventType,
    summary,
    detail: options.detail ?? {},
  });

  if (error) throw new Error(`ACTIVITY_RECORD_FAILED: ${error.message}`);
}

interface RawJobRow {
  id: string;
  workspace_id: string;
  job_type: string;
  state: JobState;
  idempotency_key: string;
  attempt: number | string;
  max_attempts: number | string;
  available_at: string;
  lease_expires_at: string | null;
  payload: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  error_code: string | null;
  error_summary: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapJobRow(row: unknown): JobRecord {
  const r = row as RawJobRow;
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    jobType: r.job_type,
    state: r.state,
    idempotencyKey: r.idempotency_key,
    attempt: Number(r.attempt ?? 0),
    maxAttempts: Number(r.max_attempts ?? 1),
    availableAt: r.available_at,
    leaseExpiresAt: r.lease_expires_at,
    payload: r.payload ?? {},
    result: r.result,
    errorCode: r.error_code,
    errorSummary: r.error_summary,
    completedAt: r.completed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
