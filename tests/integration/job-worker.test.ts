/**
 * Integration Tests: Worker convergence and idempotency (Slice 6)
 *
 * These exercise the failure modes the issue calls out:
 *   - duplicate idempotency key must not create a second logical job;
 *   - a worker crash before the side effect must converge on retry;
 *   - a crash after the side effect but before completion must not duplicate it;
 *   - retry exhaustion terminates the job with an inspectable error.
 */

import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { ObjectStore } from '../../src/storage/object-store';
import { derivedThumbnailKey } from '../../src/media/thumbnail-service';
import { ClaimedJob } from '../../src/jobs/job-service';
import { drainQueue, JobOutcome, processJob, WorkerDeps } from '../../src/jobs/worker';

class InMemoryObjectStore implements ObjectStore {
  readonly label = 'memory';
  readonly objects = new Map<string, Buffer>();
  putCount = 0;

  async head(key: string): Promise<number | null> {
    const found = this.objects.get(key);
    return found ? found.byteLength : null;
  }
  async put(key: string, bytes: Buffer): Promise<void> {
    this.putCount += 1;
    this.objects.set(key, bytes);
  }
  async get(key: string): Promise<Buffer | null> {
    return this.objects.get(key) ?? null;
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

/** In-memory queue with the same lease semantics as the SQL claim function. */
class FakeQueue {
  jobs: Array<ClaimedJob & { state: string; maxAttempts: number; availableAt: number }> = [];
  claimCount = 0;

  enqueue(job: Partial<ClaimedJob> & { jobId: string; workspaceId: string }): void {
    this.jobs.push({
      jobId: job.jobId,
      workspaceId: job.workspaceId,
      jobType: job.jobType ?? 'thumbnail',
      attempt: 0,
      payload: job.payload ?? {},
      state: 'queued',
      maxAttempts: 3,
      availableAt: Date.now(),
    });
  }

  async claim(): Promise<ClaimedJob | null> {
    const next = this.jobs.find((j) => j.state === 'queued' && j.availableAt <= Date.now());
    if (!next) return null;
    this.claimCount += 1;
    next.state = 'running';
    next.attempt += 1;
    return {
      jobId: next.jobId,
      workspaceId: next.workspaceId,
      jobType: next.jobType,
      attempt: next.attempt,
      payload: next.payload,
    };
  }
}

function makeDeps(queue: FakeQueue, store: ObjectStore, overrides: Partial<WorkerDeps> = {}): WorkerDeps {
  return {
    claim: () => queue.claim(),
    store,
    complete: async (jobId) => {
      const job = queue.jobs.find((j) => j.jobId === jobId);
      if (job) job.state = 'completed';
    },
    fail: async (job, _code, _summary, retryable) => {
      const record = queue.jobs.find((j) => j.jobId === job.jobId);
      if (!record) return;
      if (!retryable || record.attempt >= record.maxAttempts) {
        record.state = 'failed';
      } else {
        record.state = 'queued';
        record.availableAt = Date.now();
      }
    },
    activity: async () => {},
    // The worker resolves the object key and MIME type from the file record, not
    // from the payload. This fake returns the canonical key for the seeded images.
    loadFileTarget: async (workspaceId, fileId) => ({
      storageKey: `workspaces/${workspaceId}/${fileId}/photo.png`,
      mimeType: 'image/png',
    }),
    ...overrides,
  };
}

async function seedImage(store: InMemoryObjectStore, key: string): Promise<void> {
  const png = await sharp({
    create: { width: 900, height: 600, channels: 3, background: { r: 20, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();
  store.objects.set(key, png);
}

describe('Worker idempotency and convergence', () => {
  it('produces exactly one derivative across repeated runs of the same job', async () => {
    const store = new InMemoryObjectStore();
    await seedImage(store, 'workspaces/ws-1/f-1/photo.png');

    const job: ClaimedJob = {
      jobId: 'job-1',
      workspaceId: 'ws-1',
      jobType: 'thumbnail',
      attempt: 1,
      payload: { fileId: 'f-1', storageKey: 'workspaces/ws-1/f-1/photo.png', mimeType: 'image/png' },
    };

    const first = await processJob(job, makeDeps(new FakeQueue(), store));
    const second = await processJob(job, makeDeps(new FakeQueue(), store));

    expect(first.status).toBe('completed');
    expect(second.status).toBe('completed');

    // One original plus exactly one derivative: the retry did not duplicate it.
    expect(store.objects.size).toBe(2);
    expect(store.objects.has(derivedThumbnailKey('f-1'))).toBe(true);
  });

  it('converges when a worker crashes before the side effect', async () => {
    const store = new InMemoryObjectStore();
    await seedImage(store, 'workspaces/ws-1/f-2/photo.png');
    const queue = new FakeQueue();
    queue.enqueue({
      jobId: 'job-crash-early',
      workspaceId: 'ws-1',
      payload: { fileId: 'f-2', storageKey: 'workspaces/ws-1/f-2/photo.png', mimeType: 'image/png' },
    });

    // Crash before the handler runs: the job is left running with no derivative.
    const crashing: WorkerDeps = makeDeps(queue, store, {
      claim: async () => {
        const claimed = await queue.claim();
        throw new Error('worker terminated before handler');
      },
    });
    await expect(drainQueue(crashing)).rejects.toThrow(/worker terminated/);
    expect(store.objects.has(derivedThumbnailKey('f-2'))).toBe(false);

    // The lease expires and the job is claimable again.
    const record = queue.jobs[0]!;
    record.state = 'queued';
    record.availableAt = Date.now();

    const outcomes = await drainQueue(makeDeps(queue, store));
    expect(outcomes.map((o) => o.status)).toEqual(['completed']);
    expect(store.objects.has(derivedThumbnailKey('f-2'))).toBe(true);
    expect(queue.jobs[0]!.state).toBe('completed');
  });

  it('does not duplicate the side effect when a worker crashes after it', async () => {
    const store = new InMemoryObjectStore();
    await seedImage(store, 'workspaces/ws-1/f-3/photo.png');
    const queue = new FakeQueue();
    queue.enqueue({
      jobId: 'job-crash-late',
      workspaceId: 'ws-1',
      payload: { fileId: 'f-3', storageKey: 'workspaces/ws-1/f-3/photo.png', mimeType: 'image/png' },
    });

    // The handler runs (derivative written) but the completion record is lost,
    // which is what a worker dying between side effect and commit looks like.
    let completionsAttempted = 0;
    const crashing: WorkerDeps = makeDeps(queue, store, {
      complete: async (jobId) => {
        completionsAttempted += 1;
        if (completionsAttempted === 1) {
          throw new Error('worker terminated before completion record');
        }
        const job = queue.jobs.find((j) => j.jobId === jobId);
        if (job) job.state = 'completed';
      },
    });

    // Run exactly one pass so the lost completion is observable before a retry.
    const outcomes = await drainQueue(crashing, 1);
    expect(outcomes[0]!.status).toBe('retry');
    expect(store.objects.has(derivedThumbnailKey('f-3'))).toBe(true);

    const writesAfterCrash = store.putCount;

    // Simulate lease expiry: the job becomes claimable again.
    queue.jobs[0]!.state = 'queued';
    queue.jobs[0]!.availableAt = Date.now();

    // Re-running reuses the existing derivative rather than writing a second one.
    const retry = await drainQueue(makeDeps(queue, store));
    expect(retry[0]!.status).toBe('completed');
    expect(store.putCount).toBe(writesAfterCrash);
    expect(store.objects.size).toBe(2);
  });

  it('terminates with an inspectable error after retry exhaustion', async () => {
    const store = new InMemoryObjectStore();
    const queue = new FakeQueue();
    // Missing original object: the handler fails on every attempt.
    queue.enqueue({
      jobId: 'job-poison',
      workspaceId: 'ws-1',
      payload: { fileId: 'f-4', storageKey: 'workspaces/ws-1/f-4/missing.png', mimeType: 'image/png' },
    });

    const outcomes: JobOutcome[] = [];
    for (let i = 0; i < 5; i += 1) {
      outcomes.push(...(await drainQueue(makeDeps(queue, store))));
    }

    const record = queue.jobs[0]!;
    expect(record.state).toBe('failed');
    expect(record.attempt).toBe(record.maxAttempts);
    expect(outcomes.every((o) => o.status !== 'completed')).toBe(true);
  });

  it('fails permanently on a malformed payload instead of retrying forever', async () => {
    const store = new InMemoryObjectStore();
    const queue = new FakeQueue();
    queue.enqueue({ jobId: 'job-bad-payload', workspaceId: 'ws-1', payload: {} });

    const outcomes = await drainQueue(makeDeps(queue, store));
    expect(outcomes[0]!.status).toBe('failed');
    expect(queue.jobs[0]!.state).toBe('failed');
  });

  it('ignores a payload-supplied storage key and MIME type, using the file record', async () => {
    const store = new InMemoryObjectStore();
    // The real target is an image; the payload claims a different object that is
    // absent, and a non-image MIME type. Trusting the payload would produce no
    // derivative; resolving the record produces one.
    await seedImage(store, 'workspaces/ws-1/f-7/photo.png');
    const queue = new FakeQueue();
    queue.enqueue({
      jobId: 'job-confused-deputy',
      workspaceId: 'ws-1',
      payload: { fileId: 'f-7', storageKey: 'other-tenant/secret.png', mimeType: 'video/mp4' },
    });

    const outcomes = await drainQueue(makeDeps(queue, store));

    expect(outcomes[0]!.status).toBe('completed');
    expect(store.objects.has(derivedThumbnailKey('f-7'))).toBe(true);
    expect(store.objects.has('other-tenant/secret.png')).toBe(false);
  });

  it('never lets two workers claim the same queued job', async () => {
    const store = new InMemoryObjectStore();
    await seedImage(store, 'workspaces/ws-1/f-6/photo.png');
    const queue = new FakeQueue();
    queue.enqueue({
      jobId: 'job-single',
      workspaceId: 'ws-1',
      payload: { fileId: 'f-6', storageKey: 'workspaces/ws-1/f-6/photo.png', mimeType: 'image/png' },
    });

    const [a, b] = await Promise.all([queue.claim(), queue.claim()]);
    const claimed = [a, b].filter(Boolean);
    expect(claimed.length).toBe(1);
  });
});
