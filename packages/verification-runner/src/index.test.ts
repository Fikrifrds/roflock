import {
  sealChangeContract,
  sealExecutionPlan,
  type UnhashedChangeContract,
  type UnhashedExecutionPlan,
} from '@roleflock/change-contracts';
import { describe, expect, it } from 'vitest';
import {
  assertFrozenVerificationInput,
  freezeVerificationSpecification,
  sealVerificationSpecification,
  verifyVerificationSpecificationHash,
  type UnhashedVerificationSpecification,
} from './index.js';

const approvedAt = '2026-07-28T10:00:00.000Z';

function contractInput(): UnhashedChangeContract {
  return {
    id: 'contract_1',
    taskId: 'task_1',
    projectId: 'project_1',
    repositoryId: 'project_1',
    version: 1,
    status: 'authorised',
    objective: 'Make checkout idempotent.',
    acceptanceCriteria: [
      {
        id: 'AC-1',
        statement: 'A repeated request creates exactly one order.',
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
        description: 'Idempotency integration result.',
        mandatory: true,
      },
    ],
    authoritySources: [
      {
        id: 'SRC-1',
        kind: 'user_input',
        locator: 'task://task_1',
        digest: 'a'.repeat(64),
      },
    ],
    unresolvedQuestions: [],
    draftedBy: 'planner',
    authorisedBy: 'authority',
    authorisedAt: approvedAt,
    createdAt: approvedAt,
  };
}

function planInput(contractHash: string): UnhashedExecutionPlan {
  return {
    id: 'plan_1',
    taskId: 'task_1',
    contractId: 'contract_1',
    contractHash,
    version: 1,
    status: 'approved',
    summary: 'Implement checkout idempotency.',
    assumptions: [],
    steps: [
      {
        id: 'STEP-1',
        objective: 'Implement and test idempotency.',
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
      allowedFailureClasses: [],
      maxAttempts: 0,
      mayAddFiles: false,
      mayChangeDependencies: false,
      mayChangePublicApi: false,
      mayChangeSchema: false,
      pathScope: ['src'],
    },
    changeBudget: {
      maxChangedFiles: 2,
      maxAddedLines: 100,
      maxDeletedLines: 100,
      maxNewDependencies: 0,
    },
    decisionLog: [],
    proposedBy: {
      invocationId: 'planner_invocation',
      role: 'planner',
      providerId: 'provider',
      modelId: 'model',
    },
    reviewedBy: { actorId: 'authority', actorType: 'human' },
    approvedAt,
  };
}

function specificationInput(
  contractHash: string,
  planHash: string,
): UnhashedVerificationSpecification {
  return {
    id: 'verification_1',
    taskId: 'task_1',
    contractHash,
    planId: 'plan_1',
    planHash,
    version: 1,
    status: 'approved',
    checks: [
      {
        id: 'CHECK-1',
        criterionIds: ['AC-1'],
        required: true,
        description: 'Run the checkout integration test.',
        kind: 'command',
        argv: ['pnpm', 'test', '--', 'checkout-idempotency'],
        timeoutMs: 120_000,
        expectedExitCodes: [0],
      },
    ],
    environment: {
      platform: 'linux',
      architecture: 'x64',
      requiredTools: [{ name: 'node', versionConstraint: '>=24' }],
      network: 'deny',
      networkAllowlist: [],
      environmentVariableAllowlist: ['CI'],
      credentialProfileId: 'verifier-no-writer-secrets',
    },
    testMutationPolicy: 'forbid',
    minimumEvidence: [
      {
        id: 'E-1',
        criterionId: 'AC-1',
        evidenceType: 'test_result',
        minimumCount: 1,
        mandatory: true,
      },
    ],
    authoredBy: {
      invocationId: 'test_planner',
      role: 'test_planner',
      providerId: 'provider',
      modelId: 'model',
    },
    approvedBy: { actorId: 'authority', actorType: 'human' },
    approvedAt,
  };
}

describe('Verification Specification freeze gate', () => {
  it('freezes exact argv against the authorised contract and approved plan hashes', () => {
    const contract = sealChangeContract(contractInput());
    const plan = sealExecutionPlan(planInput(contract.hash));
    const specification = sealVerificationSpecification(
      specificationInput(contract.hash, plan.hash),
    );
    const frozen = freezeVerificationSpecification(specification, contract, plan);

    expect(verifyVerificationSpecificationHash(frozen)).toBe(true);
    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen(frozen.checks[0])).toBe(true);
    expect(() => frozen.checks[0]!.criterionIds.push('AC-2')).toThrow();
    expect(() =>
      assertFrozenVerificationInput({ ...specification, hash: 'f'.repeat(64) }, specification.hash),
    ).toThrow(/changed after approval/);
  });

  it('fails closed when contract, plan, or criterion identity drifts', () => {
    const contract = sealChangeContract(contractInput());
    const plan = sealExecutionPlan(planInput(contract.hash));
    const specification = sealVerificationSpecification({
      ...specificationInput(contract.hash, plan.hash),
      checks: [
        {
          ...specificationInput(contract.hash, plan.hash).checks[0]!,
          criterionIds: ['AC-UNKNOWN'],
        },
      ],
      minimumEvidence: [
        {
          id: 'E-UNKNOWN',
          criterionId: 'AC-UNKNOWN',
          evidenceType: 'test_result',
          minimumCount: 1,
          mandatory: true,
        },
      ],
    });

    expect(() => freezeVerificationSpecification(specification, contract, plan)).toThrow(
      /unknown criterion/,
    );
    const otherPlan = sealExecutionPlan({ ...planInput(contract.hash), id: 'plan_other' });
    expect(() =>
      freezeVerificationSpecification(
        sealVerificationSpecification(specificationInput(contract.hash, otherPlan.hash)),
        contract,
        otherPlan,
      ),
    ).toThrow(/different Verification Specification|approved plan/);
  });
});
