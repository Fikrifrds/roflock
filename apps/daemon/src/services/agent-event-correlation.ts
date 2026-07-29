import { sha256Canonical } from '@roleflock/contracts';
import { WorktreeRepository, type SqliteDb } from '@roleflock/database';
import type { ExternalAgentBinding, NormalizedAgentEvent } from '@roleflock/agent-events';
import { buildTaskHandoff } from './task-handoff.js';

export class AgentEventCorrelationError extends Error {
  constructor(
    readonly code:
      | 'TASK_CLAIM_MISMATCH'
      | 'CONTRACT_CLAIM_MISMATCH'
      | 'PLAN_CLAIM_MISMATCH'
      | 'WORKTREE_CLAIM_MISMATCH'
      | 'BASE_COMMIT_CLAIM_MISMATCH',
    message: string,
  ) {
    super(message);
    this.name = 'AgentEventCorrelationError';
  }
}

export function currentAgentEventBinding(
  db: SqliteDb,
  taskId: string,
  actorId: string,
): ExternalAgentBinding {
  const handoff = buildTaskHandoff(db, taskId);
  const worktree = new WorktreeRepository(db).getByTask(taskId);
  if (!worktree) throw new Error(`Task worktree is unavailable: ${taskId}`);
  return {
    taskId,
    contractHash: handoff.manifest.authority.contractHash,
    planHash: handoff.manifest.authority.planHash,
    worktreeId: worktree.id,
    worktreePathHash: sha256Canonical(worktree.path),
    actorId,
    baseCommit: worktree.baseCommit,
  };
}

export function assertAgentEventCorrelation(
  db: SqliteDb,
  routeTaskId: string,
  event: NormalizedAgentEvent,
): void {
  if (event.binding.taskId !== routeTaskId) {
    throw new AgentEventCorrelationError(
      'TASK_CLAIM_MISMATCH',
      `Event claims task ${event.binding.taskId}, endpoint is bound to ${routeTaskId}`,
    );
  }
  const expected = currentAgentEventBinding(db, routeTaskId, event.binding.actorId);
  assertAgentEventBinding(expected, routeTaskId, event.binding);
}

export function assertAgentEventBinding(
  expected: ExternalAgentBinding,
  routeTaskId: string,
  actual: ExternalAgentBinding,
): void {
  if (actual.taskId !== routeTaskId) {
    throw new AgentEventCorrelationError(
      'TASK_CLAIM_MISMATCH',
      `Event claims task ${actual.taskId}, endpoint is bound to ${routeTaskId}`,
    );
  }
  if (actual.contractHash !== expected.contractHash) {
    throw new AgentEventCorrelationError(
      'CONTRACT_CLAIM_MISMATCH',
      'Event does not claim the exact current authorised Change Contract',
    );
  }
  if (actual.planHash !== expected.planHash) {
    throw new AgentEventCorrelationError(
      'PLAN_CLAIM_MISMATCH',
      'Event does not claim the exact current approved Execution Plan',
    );
  }
  if (
    actual.worktreeId !== expected.worktreeId ||
    actual.worktreePathHash !== expected.worktreePathHash
  ) {
    throw new AgentEventCorrelationError(
      'WORKTREE_CLAIM_MISMATCH',
      'Event worktree identity or path hash does not match the task worktree',
    );
  }
  if (actual.baseCommit !== expected.baseCommit) {
    throw new AgentEventCorrelationError(
      'BASE_COMMIT_CLAIM_MISMATCH',
      'Event base commit does not match the pinned task worktree base',
    );
  }
}
