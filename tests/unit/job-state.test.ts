/**
 * Unit Tests: Job state machine (Slice 6)
 */

import { describe, expect, it } from 'vitest';
import { canTransition, isTerminal, JobState } from '../../src/jobs/job-service';

describe('Job state machine', () => {
  it('allows the documented forward path', () => {
    expect(canTransition('queued', 'running')).toBe(true);
    expect(canTransition('running', 'completed')).toBe(true);
  });

  it('allows a retryable failure to return to queued', () => {
    expect(canTransition('running', 'queued')).toBe(true);
    expect(canTransition('failed', 'queued')).toBe(true);
  });

  it('allows pausing and resuming', () => {
    expect(canTransition('queued', 'paused')).toBe(true);
    expect(canTransition('paused', 'queued')).toBe(true);
  });

  it('treats completed and failed as terminal', () => {
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('failed')).toBe(true);
    expect(isTerminal('queued')).toBe(false);
    expect(isTerminal('running')).toBe(false);

    // Terminal states never transition again, so completion cannot be undone.
    for (const state of ['queued', 'running', 'paused', 'failed'] as JobState[]) {
      expect(canTransition('completed', state)).toBe(false);
    }
  });

  it('does not allow skipping straight from queued to completed', () => {
    expect(canTransition('queued', 'completed')).toBe(false);
  });
});
