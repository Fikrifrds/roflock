import { describe, expect, it } from 'vitest';
import {
  compilePlannerPlanProposal,
  parsePlannerPlanProposal,
  plannerStructuredOutputPrompt,
} from './planner-output.js';
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
        statement: 'Duplicate requests create one order.',
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
        description: 'Idempotency integration test.',
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
    draftedBy: 'contract_planner',
    authorisedBy: 'authority_1',
    authorisedAt: '2026-07-28T08:00:00.000Z',
    createdAt: '2026-07-28T07:00:00.000Z',
  };
}

function proposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    summary: 'Implement idempotent checkout.',
    assumptions: [],
    steps: [
      {
        id: 'STEP-1',
        objective: 'Enforce idempotency.',
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
      allowedFailureClasses: ['formatting'],
      maxAttempts: 1,
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
    ...overrides,
  };
}

const invocation = {
  invocationId: 'invocation_1',
  role: 'planner',
  providerId: 'provider_1',
  modelId: 'model_1',
};

describe('planner structured output', () => {
  it('compiles model JSON into a sealed proposed plan pinned by RoleFlock', () => {
    const contract = sealChangeContract(contractInput());
    const plan = compilePlannerPlanProposal({
      output: `\`\`\`json\n${JSON.stringify(proposal())}\n\`\`\``,
      planId: 'plan_1',
      version: 1,
      contract,
      proposedBy: invocation,
    });

    expect(plan).toMatchObject({
      id: 'plan_1',
      taskId: contract.taskId,
      contractId: contract.id,
      contractHash: contract.hash,
      status: 'proposed',
      proposedBy: invocation,
      hashAlgorithm: 'sha256',
    });
  });

  it('rejects model attempts to self-approve or inject identity', () => {
    expect(() =>
      parsePlannerPlanProposal(
        JSON.stringify(
          proposal({
            status: 'approved',
            approvedAt: '2026-07-28T09:00:00.000Z',
            contractHash: 'f'.repeat(64),
          }),
        ),
      ),
    ).toThrow(/Unrecognized key/);
  });

  it('rejects unknown contract criteria and missing revision lineage', () => {
    const contract = sealChangeContract(contractInput());
    const firstStep = (proposal().steps as Array<Record<string, unknown>>)[0]!;
    expect(() =>
      compilePlannerPlanProposal({
        output: JSON.stringify(
          proposal({
            steps: [{ ...firstStep, criterionIds: ['AC-404'] }],
          }),
        ),
        planId: 'plan_1',
        version: 1,
        contract,
        proposedBy: invocation,
      }),
    ).toThrow(/unknown criterion AC-404/);

    expect(() =>
      compilePlannerPlanProposal({
        output: JSON.stringify(proposal()),
        planId: 'plan_2',
        version: 2,
        contract,
        proposedBy: invocation,
      }),
    ).toThrow();
  });

  it('makes the structured-output authority boundary explicit in the prompt', () => {
    const prompt = plannerStructuredOutputPrompt(sealChangeContract(contractInput()));
    expect(prompt).toContain('cannot approve');
    expect(prompt).toContain('AC-1');
    expect(prompt).toContain('E-1');
    expect(prompt).toContain('repository-relative paths');
  });
});
