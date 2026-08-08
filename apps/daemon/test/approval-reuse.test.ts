import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfirmationRepository, openMigratedDatabase } from '@roleflock/database';
import type { ConfirmationRequest } from '@roleflock/contracts';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * A human decision is about a specific state.
 *
 * Resuming after a restart re-enters the graph at the reviewer, and asking the
 * same person the same question about the same commit adds nothing — it makes
 * recovery tedious enough to avoid. Reuse is therefore bound to `stateHash`: if
 * the base commit moved, the earlier approval no longer covers what is being
 * proposed and must be asked again.
 */

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function repository() {
  const directory = mkdtempSync(join(tmpdir(), 'roflock-approval-'));
  directories.push(directory);
  return new ConfirmationRepository(openMigratedDatabase(join(directory, 'test.db')));
}

function request(overrides: Partial<ConfirmationRequest> = {}): ConfirmationRequest {
  return {
    id: 'cnf_1',
    taskId: 'task_1',
    graphRunId: 'run_1',
    nodeRunId: 'node_1',
    requestType: 'expand_scope',
    rationale: 'Confirm the proposed fix scope before writing.',
    exactAction: {
      kind: 'scope',
      verb: 'confirm',
      target: 'bug_fix',
      paths: ['**'],
      sideEffectClass: 'local_write',
    },
    affectedPaths: ['**'],
    riskClass: 'medium',
    stateHash: 'commit_aaa',
    fingerprint: 'fp_1',
    status: 'pending',
    createdAt: new Date().toISOString(),
    ...overrides,
  } as ConfirmationRequest;
}

/** Mirrors the orchestrator's reuse rule. */
function reusable(
  confirmations: ConfirmationRepository,
  taskId: string,
  requestType: string,
  stateHash: string,
): ConfirmationRequest | undefined {
  return confirmations
    .listByTask(taskId)
    .find(
      (candidate) =>
        candidate.status === 'approved' &&
        candidate.requestType === requestType &&
        candidate.stateHash === stateHash,
    );
}

describe('carrying an approval across a resume', () => {
  it('reuses a decision given for the same state', () => {
    const confirmations = repository();
    confirmations.create(request());
    confirmations.setStatus('cnf_1', 'approved', new Date().toISOString());

    expect(reusable(confirmations, 'task_1', 'expand_scope', 'commit_aaa')?.id).toBe('cnf_1');
  });

  it('asks again when the state has moved', () => {
    const confirmations = repository();
    confirmations.create(request());
    confirmations.setStatus('cnf_1', 'approved', new Date().toISOString());

    // The approval was about `commit_aaa`. A different base commit is a
    // different proposal, and reusing the decision would put words in the
    // reviewer's mouth.
    expect(reusable(confirmations, 'task_1', 'expand_scope', 'commit_bbb')).toBeUndefined();
  });

  it('does not reuse a decision that was never given', () => {
    const confirmations = repository();
    confirmations.create(request());

    expect(reusable(confirmations, 'task_1', 'expand_scope', 'commit_aaa')).toBeUndefined();
  });

  it('does not reuse a rejection as though it were an approval', () => {
    const confirmations = repository();
    confirmations.create(request());
    confirmations.setStatus('cnf_1', 'rejected', new Date().toISOString());

    expect(reusable(confirmations, 'task_1', 'expand_scope', 'commit_aaa')).toBeUndefined();
  });

  it('keeps decisions for different request types apart', () => {
    const confirmations = repository();
    confirmations.create(request());
    confirmations.setStatus('cnf_1', 'approved', new Date().toISOString());

    // Approving a scope expansion is not approving anything else that happens to
    // concern the same commit.
    expect(reusable(confirmations, 'task_1', 'run_command', 'commit_aaa')).toBeUndefined();
  });

  it('does not leak an approval between tasks', () => {
    const confirmations = repository();
    confirmations.create(request());
    confirmations.setStatus('cnf_1', 'approved', new Date().toISOString());

    expect(reusable(confirmations, 'task_2', 'expand_scope', 'commit_aaa')).toBeUndefined();
  });
});
