import { describe, expect, it } from 'vitest';
import type { ExternalAgentBinding } from '@roleflock/agent-events';
import { AgentEventCorrelationError, assertAgentEventBinding } from './agent-event-correlation.js';

describe('external agent task correlation', () => {
  it('rejects a session attempting to claim another task authority binding', () => {
    expect(() =>
      assertAgentEventBinding(expected, 'task_1', {
        ...expected,
        taskId: 'task_2',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AgentEventCorrelationError>>({
        code: 'TASK_CLAIM_MISMATCH',
      }),
    );
  });

  it('rejects stale plan and foreign worktree claims', () => {
    expect(() =>
      assertAgentEventBinding(expected, 'task_1', {
        ...expected,
        planHash: '9'.repeat(64),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AgentEventCorrelationError>>({
        code: 'PLAN_CLAIM_MISMATCH',
      }),
    );
    expect(() =>
      assertAgentEventBinding(expected, 'task_1', {
        ...expected,
        worktreeId: 'foreign_worktree',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AgentEventCorrelationError>>({
        code: 'WORKTREE_CLAIM_MISMATCH',
      }),
    );
  });
});

const expected: ExternalAgentBinding = {
  taskId: 'task_1',
  contractHash: '1'.repeat(64),
  planHash: '2'.repeat(64),
  worktreeId: 'worktree_1',
  worktreePathHash: '3'.repeat(64),
  actorId: 'actor_1',
  baseCommit: '4'.repeat(40),
};
