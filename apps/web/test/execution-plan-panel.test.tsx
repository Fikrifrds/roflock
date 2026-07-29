import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ExecutionPlanPanel } from '../src/components/ExecutionPlanPanel.js';
import type { ExecutionPlan, ExecutionPlanResponse, PlanDeviation, Task } from '../src/types.js';
import { renderApp, stubApi } from './render.js';

const task: Task = {
  id: 't1',
  projectId: 'p1',
  title: 'Idempotent checkout',
  type: 'bug_fix',
  state: 'ready',
  risk: 'high',
  brief: 'Prevent duplicate checkout submissions.',
  maxAttempts: 3,
  workflowGraphVersionId: 'bug_fix@3',
};

function plan(status: ExecutionPlan['status']): ExecutionPlan {
  return {
    id: 'plan_1',
    taskId: task.id,
    contractId: 'contract_1',
    contractHash: 'a'.repeat(64),
    version: 1,
    status,
    summary: 'Implement checkout idempotency without changing payment semantics.',
    assumptions: [],
    steps: [
      {
        id: 'STEP-1',
        objective: 'Implement and verify checkout idempotency.',
        criterionIds: ['AC-1'],
        allowedOperations: ['modify_file', 'run_command'],
        expectedFiles: ['src/checkout.ts'],
        completionEvidenceIds: ['E-1'],
      },
    ],
    allowedPaths: ['src'],
    expectedChangedPaths: ['src/checkout.ts'],
    forbiddenPaths: ['infra'],
    dependencyChanges: [],
    migrationActions: [],
    verificationSpecId: 'verification_1',
    repairEnvelope: {
      allowedFailureClasses: ['formatting'],
      maxAttempts: 1,
      mayAddFiles: false,
      mayChangeDependencies: false,
      mayChangePublicApi: false,
      mayChangeSchema: false,
      pathScope: ['src'],
    },
    changeBudget: {
      maxChangedFiles: 2,
      maxAddedLines: 120,
      maxDeletedLines: 80,
      maxNewDependencies: 0,
    },
    decisionLog: [],
    proposedBy: {
      invocationId: 'planner_1',
      role: 'planner',
      providerId: 'claude-code',
      modelId: 'claude-opus',
    },
    reviewedBy: status === 'approved' ? { actorId: 'user_fikri', actorType: 'human' } : undefined,
    approvedAt: status === 'approved' ? '2026-07-28T08:00:00.000Z' : undefined,
    hashAlgorithm: 'sha256',
    hash: 'b'.repeat(64),
  };
}

function deviation(): PlanDeviation {
  return {
    id: 'deviation_1',
    planId: 'plan_1',
    planHash: 'b'.repeat(64),
    detectedBy: 'executor',
    type: 'scope_expansion',
    evidence: [{ id: 'diff_1', digest: 'c'.repeat(64) }],
    proposedOptions: ['Return to planner and revise the scope.'],
    status: 'open',
    hash: 'd'.repeat(64),
  };
}

function response(value: ExecutionPlan, deviations: PlanDeviation[] = []): ExecutionPlanResponse {
  return {
    aggregate: {
      id: value.id,
      taskId: value.taskId,
      contractId: value.contractId,
      currentVersion: value.version,
      currentSnapshotId: `${value.id}:v${value.version}:${value.hash}`,
      currentHash: value.hash,
      status: value.status,
      revision: 2,
      createdAt: '2026-07-28T07:00:00.000Z',
      updatedAt: '2026-07-28T08:00:00.000Z',
    },
    plan: value,
    snapshots: [value],
    deviations,
  };
}

describe('ExecutionPlanPanel', () => {
  it('shows sealed boundaries, steps, budget, lineage, and deviations', async () => {
    const value = plan('approved');
    const planResponse = response(value, [deviation()]);
    planResponse.collisions = [
      {
        taskId: 'task_parallel',
        planId: 'plan_parallel',
        planHash: 'e'.repeat(64),
        path: 'src/checkout.ts',
        conflictingPath: 'src/checkout.ts',
        kind: 'exact',
      },
    ];
    stubApi({
      '/api/tasks/t1/execution-plan': planResponse,
    });

    renderApp(<ExecutionPlanPanel task={task} />);

    expect(await screen.findByText('approved')).toBeInTheDocument();
    expect(
      screen.getByText('Implement checkout idempotency without changing payment semantics.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/STEP-1: Implement and verify checkout idempotency/),
    ).toBeInTheDocument();
    expect(screen.getByText('scope expansion')).toBeInTheDocument();
    expect(screen.getAllByText('src/checkout.ts').length).toBeGreaterThan(0);
    expect(screen.getByText('Expected path overlap with active work')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Approve execution plan' }),
    ).not.toBeInTheDocument();
  });

  it('approves only the exact visible plan revision', async () => {
    const value = plan('proposed');
    const fetchMock = stubApi({
      '/api/tasks/t1/execution-plan': response(value),
      '/api/execution-plans/plan_1/approve': response({ ...value, status: 'approved' }),
    });

    renderApp(<ExecutionPlanPanel task={task} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Approve execution plan' }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(
        ([path]) => path === '/api/execution-plans/plan_1/approve',
      );
      expect(call).toBeDefined();
      expect((call?.[1] as RequestInit).headers).toMatchObject({
        'if-match': '"2"',
        'x-roleflock-actor-id': 'local-user',
      });
    });
  });

  it('keeps an absent planner proposal visibly blocked', async () => {
    stubApi({
      '/api/tasks/t1/execution-plan': {
        code: 'EXECUTION_PLAN_NOT_FOUND',
        error: 'execution plan not found',
      },
    });

    renderApp(<ExecutionPlanPanel task={task} />);

    expect(
      await screen.findByText(/No Execution Plan has been proposed for this task/i),
    ).toBeInTheDocument();
    // The blocked state must also offer the way out of it, or the assurance
    // chain is unreachable without hand-crafted API calls.
    expect(screen.getByRole('button', { name: 'Propose plan from contract' })).toBeInTheDocument();
  });
});
