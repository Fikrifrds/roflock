import { describe, expect, it } from 'vitest';
import {
  ChangeContractSchema,
  createChangeContractHash,
  parseVerifiedChangeContract,
  sealChangeContract,
  type UnhashedChangeContract,
  UnhashedChangeContractSchema,
  verifyChangeContractHash,
} from './index.js';

function validContract(): UnhashedChangeContract {
  return {
    id: 'contract_checkout',
    taskId: 'task_checkout',
    projectId: 'project_shop',
    repositoryId: 'repo_shop',
    version: 1,
    status: 'authorised',
    objective: 'Prevent duplicate checkout submission.',
    acceptanceCriteria: [
      {
        id: 'AC-1',
        statement: 'A repeated checkout request creates only one order.',
        verificationType: 'automated_test',
        requiredEvidenceIds: ['E-2', 'E-1'],
      },
      {
        id: 'AC-2',
        statement: 'The checkout screen remains visually unchanged.',
        verificationType: 'visual_review',
        requiredEvidenceIds: ['E-2'],
      },
    ],
    prohibitedOutcomes: [
      {
        id: 'PO-2',
        statement: 'Do not change the payment provider.',
        severity: 'critical',
      },
      {
        id: 'PO-1',
        statement: 'Do not weaken existing checkout tests.',
        severity: 'high',
      },
    ],
    outOfScope: ['Payment-provider migration', 'Checkout redesign'],
    risk: 'high',
    requiredEvidence: [
      {
        id: 'E-2',
        type: 'visual_artifact',
        description: 'Before and after checkout screenshots.',
        mandatory: true,
      },
      {
        id: 'E-1',
        type: 'test_result',
        description: 'Automated duplicate-submission test result.',
        mandatory: true,
      },
    ],
    authoritySources: [
      {
        id: 'SRC-2',
        kind: 'organisation_policy',
        locator: 'policy://checkout/safety',
        digest: 'b'.repeat(64),
      },
      {
        id: 'SRC-1',
        kind: 'user_input',
        locator: 'request://task_checkout',
        digest: 'a'.repeat(64),
      },
    ],
    unresolvedQuestions: [
      {
        id: 'Q-1',
        question: 'Must duplicate requests return the original response?',
        blocking: true,
        status: 'resolved',
        resolution: 'Yes, return the original successful response.',
        resolvedBy: 'user_fikri',
        resolvedAt: '2026-07-28T08:00:00.000Z',
      },
    ],
    draftedBy: 'planner_1',
    authorisedBy: 'user_fikri',
    authorisedAt: '2026-07-28T08:05:00.000Z',
    createdAt: '2026-07-28T07:30:00.000Z',
  };
}

describe('Change Contract schema', () => {
  it('accepts an authorised contract with explicit authority and evidence', () => {
    const contract = sealChangeContract(validContract());

    expect(ChangeContractSchema.parse(contract)).toEqual(contract);
    expect(contract.hashAlgorithm).toBe('sha256');
    expect(verifyChangeContractHash(contract)).toBe(true);
  });

  it('rejects duplicate criterion IDs and unknown evidence references', () => {
    const contract = validContract();
    contract.acceptanceCriteria.push({
      id: 'AC-1',
      statement: 'The duplicate criterion.',
      verificationType: 'automated_test',
      requiredEvidenceIds: ['E-404'],
    });

    const result = UnhashedChangeContractSchema.safeParse(contract);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual(
        expect.arrayContaining([
          'Duplicate id: AC-1',
          'Unknown required evidence reference: E-404',
        ]),
      );
    }
  });

  it('prevents authorisation while a blocking question remains open', () => {
    const contract = validContract();
    contract.unresolvedQuestions = [
      {
        id: 'Q-1',
        question: 'Which idempotency key is authoritative?',
        blocking: true,
        status: 'open',
      },
    ];

    expect(() => sealChangeContract(contract)).toThrow(/Blocking question remains open/);
  });

  it('requires revision lineage and a reason after version one', () => {
    const contract = validContract();
    contract.version = 2;

    expect(() => sealChangeContract(contract)).toThrow(/requires parentVersionId and changeReason/);
  });

  it('normalises set-like collections for a stable canonical hash', () => {
    const first = validContract();
    const reordered = validContract();
    reordered.prohibitedOutcomes.reverse();
    reordered.outOfScope.reverse();
    reordered.requiredEvidence.reverse();
    reordered.authoritySources.reverse();
    reordered.acceptanceCriteria[0]!.requiredEvidenceIds.reverse();

    expect(createChangeContractHash(reordered)).toBe(createChangeContractHash(first));
  });

  it('preserves criterion ordering because it has semantic review meaning', () => {
    const first = validContract();
    const reordered = validContract();
    reordered.acceptanceCriteria.reverse();

    expect(createChangeContractHash(reordered)).not.toBe(createChangeContractHash(first));
  });

  it('detects mutation after a contract has been sealed', () => {
    const contract = sealChangeContract(validContract());
    const mutated = { ...contract, objective: 'A different objective.' };

    expect(verifyChangeContractHash(mutated)).toBe(false);
    expect(() => parseVerifiedChangeContract(mutated)).toThrow(/hash mismatch/);
  });

  it('keeps the canonical golden hash stable', () => {
    expect(createChangeContractHash(validContract())).toBe(
      'c8ef52fc59cb340dbace35fa504bee63b6748200a151cb4db064353e91b37d3f',
    );
  });
});
