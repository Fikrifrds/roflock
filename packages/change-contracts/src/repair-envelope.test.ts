import { describe, expect, it } from 'vitest';
import {
  classifyMechanicalFailure,
  evaluateRepairEnvelope,
  type RepairEvaluationInput,
} from './repair-envelope.js';
import { sealExecutionPlan, type UnhashedExecutionPlan } from './execution-artifacts.js';

function planInput(): UnhashedExecutionPlan {
  return {
    id: 'plan_1',
    taskId: 'task_1',
    contractId: 'contract_1',
    contractHash: 'a'.repeat(64),
    version: 1,
    status: 'approved',
    summary: 'Apply and verify a planned change.',
    assumptions: [],
    steps: [
      {
        id: 'STEP-1',
        objective: 'Modify checkout.',
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
      allowedFailureClasses: ['formatting', 'lint_autofix'],
      maxAttempts: 1,
      mayAddFiles: false,
      mayChangeDependencies: false,
      mayChangePublicApi: false,
      mayChangeSchema: false,
      pathScope: ['src/checkout.ts'],
    },
    changeBudget: {
      maxChangedFiles: 2,
      maxAddedLines: 100,
      maxDeletedLines: 100,
      maxNewDependencies: 0,
    },
    decisionLog: [],
    proposedBy: {
      invocationId: 'planner_1',
      role: 'planner',
      providerId: 'provider_a',
      modelId: 'model_a',
    },
    reviewedBy: { actorId: 'authority_1', actorType: 'human' },
    approvedAt: '2026-07-28T10:00:00.000Z',
  };
}

const safeRepair: RepairEvaluationInput = {
  failureClass: 'formatting',
  changedPaths: ['src/checkout.ts'],
  requiredOperations: ['modify_file', 'run_command'],
  attempt: 1,
  deterministic: true,
  addsFiles: false,
  changesDependencies: false,
  changesPublicApi: false,
  changesSchema: false,
  requiresArchitectureDecision: false,
  expandsScope: false,
  changesRequirement: false,
  planStillSufficient: true,
  contractStillSufficient: true,
  retryBudgetRemaining: true,
  costBudgetRemaining: true,
  timeBudgetRemaining: true,
};

describe('repair envelope', () => {
  it('allows only a fully mechanical repair inside every approved boundary', () => {
    const result = evaluateRepairEnvelope(sealExecutionPlan(planInput()), safeRepair);
    expect(result).toMatchObject({
      allowed: true,
      decision: 'repair_allowed',
      reasons: [],
    });
  });

  it('returns every failed predicate and requires planner', () => {
    const result = evaluateRepairEnvelope(sealExecutionPlan(planInput()), {
      ...safeRepair,
      failureClass: 'test_snapshot',
      changedPaths: ['src/other.ts'],
      attempt: 2,
      changesDependencies: true,
      requiresArchitectureDecision: true,
      planStillSufficient: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        'failure_class_not_allowed',
        'repair_attempt_budget_exhausted',
        'dependency_change_not_allowed',
        'architecture_decision_required',
        'plan_insufficient',
        'path_outside_repair_scope:src/other.ts',
      ]),
    );
  });

  it('classifies only named deterministic failure families', () => {
    expect(classifyMechanicalFailure('Prettier formatting failed')).toBe('formatting');
    expect(classifyMechanicalFailure('eslint reported errors')).toBe('lint_autofix');
    expect(classifyMechanicalFailure('Business behaviour is wrong')).toBeUndefined();
  });
});
