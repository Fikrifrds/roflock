import { describe, expect, it } from 'vitest';
import {
  assertExecutorChangedPaths,
  assertExecutorOperationAllowed,
  executorInstructionBlock,
  executorPermissionEnvelope,
  parseApprovedExecutionPlan,
} from './executor-assignment.js';
import { sealExecutionPlan, type UnhashedExecutionPlan } from './execution-artifacts.js';

function planInput(): UnhashedExecutionPlan {
  return {
    id: 'plan_1',
    taskId: 'task_1',
    contractId: 'contract_1',
    contractHash: 'a'.repeat(64),
    version: 1,
    status: 'approved',
    summary: 'Change checkout implementation.',
    assumptions: [],
    steps: [
      {
        id: 'STEP-1',
        objective: 'Update checkout.',
        criterionIds: ['AC-1'],
        allowedOperations: ['modify_file', 'run_command'],
        expectedFiles: ['src/checkout.ts'],
        completionEvidenceIds: ['E-1'],
      },
    ],
    allowedPaths: ['src/checkout.ts', 'test/checkout'],
    expectedChangedPaths: ['src/checkout.ts'],
    forbiddenPaths: ['infra'],
    dependencyChanges: [],
    migrationActions: [],
    verificationSpecId: 'verification_1',
    repairEnvelope: {
      allowedFailureClasses: [],
      maxAttempts: 0,
      mayAddFiles: false,
      mayChangeDependencies: false,
      mayChangePublicApi: false,
      mayChangeSchema: false,
      pathScope: ['src/checkout.ts'],
    },
    changeBudget: {
      maxChangedFiles: 2,
      maxAddedLines: 100,
      maxDeletedLines: 50,
      maxNewDependencies: 0,
    },
    decisionLog: [],
    proposedBy: {
      invocationId: 'planner_invocation',
      role: 'planner',
      providerId: 'provider_a',
      modelId: 'model_a',
    },
    reviewedBy: {
      actorId: 'authority_1',
      actorType: 'human',
    },
    approvedAt: '2026-07-28T09:00:00.000Z',
  };
}

describe('executor assignment', () => {
  it('builds an exact plan-pinned prompt and least-path envelope', () => {
    const plan = sealExecutionPlan(planInput());
    const prompt = executorInstructionBlock(plan);

    expect(prompt.startsWith(`PINNED EXECUTION PLAN ${plan.id} v1`)).toBe(true);
    expect(prompt).toContain(`PLAN HASH: ${plan.hash}`);
    expect(executorPermissionEnvelope(plan, '/work')).toEqual({
      worktree: '/work',
      allowedPaths: ['src/checkout.ts', 'test/checkout'],
      allowCommands: true,
    });
  });

  it('rejects draft and tampered plans', () => {
    const { reviewedBy: _reviewedBy, approvedAt: _approvedAt, ...unapproved } = planInput();
    expect(() =>
      parseApprovedExecutionPlan(sealExecutionPlan({ ...unapproved, status: 'proposed' })),
    ).toThrow(/requires an approved plan/);

    const plan = sealExecutionPlan(planInput());
    expect(() => parseApprovedExecutionPlan({ ...plan, summary: 'Tampered.' })).toThrow(
      /hash mismatch/,
    );
  });

  it('rejects operations and changed paths outside the approved plan', () => {
    const plan = sealExecutionPlan(planInput());
    expect(() => assertExecutorOperationAllowed(plan, 'modify_file')).not.toThrow();
    expect(() => assertExecutorOperationAllowed(plan, 'add_dependency')).toThrow(
      /does not allow operation/,
    );
    expect(() =>
      assertExecutorChangedPaths(plan, ['src/checkout.ts', 'test/checkout/idempotency.test.ts']),
    ).not.toThrow();
    expect(() => assertExecutorChangedPaths(plan, ['package.json'])).toThrow(
      /outside approved plan/,
    );
  });
});
