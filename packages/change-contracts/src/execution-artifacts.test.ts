import { describe, expect, it } from 'vitest';
import {
  PlanCritiqueSchema,
  PlanDeviationSchema,
  UnhashedPlanDeviationSchema,
  createExecutionPlanHash,
  sealExecutionPlan,
  sealExecutionReport,
  sealPlanCritique,
  validateExecutionPlanAgainstContract,
  validateExecutionReportAgainstPlan,
  verifyExecutionPlanHash,
  type UnhashedExecutionPlan,
} from './execution-artifacts.js';
import { sealChangeContract, type UnhashedChangeContract } from './index.js';

function contractInput(): UnhashedChangeContract {
  return {
    id: 'contract_1',
    taskId: 'task_1',
    projectId: 'project_1',
    repositoryId: 'repository_1',
    version: 1,
    status: 'authorised',
    objective: 'Prevent duplicate checkout.',
    acceptanceCriteria: [
      {
        id: 'AC-1',
        statement: 'A repeated request creates one order.',
        verificationType: 'automated_test',
        requiredEvidenceIds: ['E-1'],
      },
    ],
    prohibitedOutcomes: [],
    outOfScope: [],
    risk: 'high',
    requiredEvidence: [
      {
        id: 'E-1',
        type: 'test_result',
        description: 'Idempotency test.',
        mandatory: true,
      },
    ],
    authoritySources: [
      {
        id: 'SRC-1',
        kind: 'user_input',
        locator: 'task://task_1/brief',
        digest: 'a'.repeat(64),
      },
    ],
    unresolvedQuestions: [],
    draftedBy: 'planner_1',
    authorisedBy: 'authority_1',
    authorisedAt: '2026-07-28T08:00:00.000Z',
    createdAt: '2026-07-28T07:00:00.000Z',
  };
}

function planInput(): UnhashedExecutionPlan {
  const contract = sealChangeContract(contractInput());
  return {
    id: 'plan_1',
    taskId: contract.taskId,
    contractId: contract.id,
    contractHash: contract.hash,
    version: 1,
    status: 'approved',
    summary: 'Add idempotency enforcement and verify it.',
    assumptions: [],
    steps: [
      {
        id: 'STEP-1',
        objective: 'Enforce idempotent checkout.',
        criterionIds: ['AC-1'],
        allowedOperations: ['modify_file', 'run_command'],
        expectedFiles: ['src/checkout.ts'],
        completionEvidenceIds: ['E-1'],
      },
    ],
    allowedPaths: ['src', 'test'],
    expectedChangedPaths: ['src/checkout.ts', 'test/checkout.test.ts'],
    forbiddenPaths: ['infra'],
    dependencyChanges: [],
    migrationActions: [],
    verificationSpecId: 'verification_1',
    repairEnvelope: {
      allowedFailureClasses: ['formatting', 'lint_autofix'],
      maxAttempts: 2,
      mayAddFiles: false,
      mayChangeDependencies: false,
      mayChangePublicApi: false,
      mayChangeSchema: false,
      pathScope: ['src', 'test'],
    },
    changeBudget: {
      maxChangedFiles: 4,
      maxAddedLines: 200,
      maxDeletedLines: 100,
      maxNewDependencies: 0,
    },
    decisionLog: [],
    proposedBy: {
      invocationId: 'invocation_planner',
      role: 'planner',
      providerId: 'provider_a',
      modelId: 'model_a',
    },
    reviewedBy: {
      invocationId: 'invocation_critic',
      role: 'plan_critic',
      providerId: 'provider_b',
      modelId: 'model_b',
    },
    approvedAt: '2026-07-28T08:30:00.000Z',
  };
}

describe('execution artifacts', () => {
  it('seals and verifies a strict approved Execution Plan', () => {
    const plan = sealExecutionPlan(planInput());

    expect(verifyExecutionPlanHash(plan)).toBe(true);
    expect(plan.hash).toBe(createExecutionPlanHash(planInput()));
  });

  it('rejects revision, approval, and path-boundary inconsistencies', () => {
    expect(() =>
      sealExecutionPlan({
        ...planInput(),
        version: 2,
        parentPlanId: undefined,
        revisionReason: undefined,
      }),
    ).toThrow(/requires parentPlanId and revisionReason/);

    expect(() =>
      sealExecutionPlan({
        ...planInput(),
        expectedChangedPaths: ['outside/file.ts'],
      }),
    ).toThrow(/outside allowed paths/);

    expect(() =>
      sealExecutionPlan({
        ...planInput(),
        forbiddenPaths: ['src/secrets'],
      }),
    ).toThrow(/nested in an allowed path/);
  });

  it('requires complete and valid contract criterion/evidence mapping', () => {
    const contract = sealChangeContract(contractInput());
    const plan = sealExecutionPlan(planInput());
    expect(() => validateExecutionPlanAgainstContract(plan, contract)).not.toThrow();

    const bad = sealExecutionPlan({
      ...planInput(),
      steps: [
        {
          ...planInput().steps[0]!,
          criterionIds: ['AC-404'],
        },
      ],
    });
    expect(() => validateExecutionPlanAgainstContract(bad, contract)).toThrow(
      /unknown criterion AC-404/,
    );
  });

  it('keeps blocking critique incompatible with approval', () => {
    const plan = sealExecutionPlan(planInput());
    expect(() =>
      sealPlanCritique({
        id: 'critique_1',
        taskId: plan.taskId,
        planId: plan.id,
        planHash: plan.hash,
        verdict: 'approve',
        findings: [
          {
            id: 'finding_1',
            criterionIds: ['AC-1'],
            severity: 'blocking',
            category: 'verification_gap',
            statement: 'A required negative test is missing.',
            evidence: [],
          },
        ],
        reviewedBy: {
          invocationId: 'invocation_critic',
          role: 'plan_critic',
          providerId: 'provider_b',
          modelId: 'model_b',
        },
        createdAt: '2026-07-28T08:20:00.000Z',
      }),
    ).toThrow(/blocking findings cannot approve/);
  });

  it('requires deviation resolution lineage and evidence', () => {
    const result = UnhashedPlanDeviationSchema.safeParse({
      id: 'deviation_1',
      planId: 'plan_1',
      planHash: 'b'.repeat(64),
      detectedBy: 'executor',
      type: 'scope_expansion',
      evidence: [{ id: 'evidence_1', digest: 'c'.repeat(64) }],
      proposedOptions: ['Revise the plan.'],
      status: 'resolved_by_plan_revision',
      resolvedBy: { actorId: 'authority_1', actorType: 'human' },
      resolvedAt: '2026-07-28T09:00:00.000Z',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/requires resolutionPlanId/);
    }
  });

  it('checks report step IDs, path boundaries, and plan pinning', () => {
    const plan = sealExecutionPlan(planInput());
    const report = sealExecutionReport({
      id: 'report_1',
      taskId: plan.taskId,
      planId: plan.id,
      planHash: plan.hash,
      baseCommit: 'a'.repeat(40),
      resultCommit: 'b'.repeat(40),
      completedStepIds: ['STEP-1'],
      changedPaths: ['src/checkout.ts'],
      commandsRun: [],
      claimedEvidence: [{ id: 'E-1', digest: 'd'.repeat(64) }],
      deviations: [],
      unresolvedIssues: [],
      createdBy: {
        invocationId: 'invocation_executor',
        role: 'executor',
        providerId: 'provider_c',
        modelId: 'model_c',
      },
      createdAt: '2026-07-28T09:00:00.000Z',
    });
    expect(() => validateExecutionReportAgainstPlan(report, plan)).not.toThrow();

    expect(() =>
      validateExecutionReportAgainstPlan({ ...report, changedPaths: ['infra/prod.tf'] }, plan),
    ).toThrow(/outside the approved plan/);
    expect(() =>
      validateExecutionReportAgainstPlan({ ...report, planHash: 'f'.repeat(64) }, plan),
    ).toThrow(/not pinned/);
  });

  it('keeps critique and deviation artifacts strict', () => {
    expect(
      PlanCritiqueSchema.safeParse({
        id: 'critique',
        unexpected: true,
      }).success,
    ).toBe(false);
    expect(
      PlanDeviationSchema.safeParse({
        id: 'deviation',
        unexpected: true,
      }).success,
    ).toBe(false);
  });
});
