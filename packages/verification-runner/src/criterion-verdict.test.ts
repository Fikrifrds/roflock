import { sealChangeContract, type UnhashedChangeContract } from '@roleflock/change-contracts';
import { sha256Canonical } from '@roleflock/contracts';
import { describe, expect, it } from 'vitest';
import {
  captureVerificationAttestations,
  evaluateCriterionVerdicts,
  sealVerificationSpecification,
  verifyVerificationDecision,
  type DeterministicVerificationRun,
  type VerificationMutationAnalysis,
} from './index.js';

const timestamp = '2026-07-28T10:00:00.000Z';
const baseCommit = '1'.repeat(40);
const resultCommit = '2'.repeat(40);

describe('criterion verdict boundary', () => {
  it('does not allow a writer PASS claim to satisfy mandatory evidence', () => {
    const fixture = fixtures();
    const decision = evaluateCriterionVerdicts({
      id: 'decision_1',
      ...fixture,
      attestations: [],
      executorClaims: [{ id: 'writer_claim_pass', criterionIds: ['AC-1'], claimedOutcome: 'pass' }],
      createdAt: timestamp,
    });

    expect(decision.overallOutcome).toBe('insufficient_evidence');
    expect(decision.verdicts[0]?.outcome).toBe('insufficient_evidence');
    expect(decision.verdicts[0]?.evidenceRefs).toEqual([]);
    expect(decision.ignoredExecutorClaimIds).toEqual(['writer_claim_pass']);
    expect(decision.findings).toMatchObject([
      { type: 'insufficient_evidence', routedTo: 'planner' },
    ]);
  });

  it('passes only with valid clean-runner evidence for the same subject', () => {
    const fixture = fixtures();
    const [attestation] = attestations(fixture);
    const decision = evaluateCriterionVerdicts({
      id: 'decision_2',
      ...fixture,
      attestations: [attestation!],
      createdAt: timestamp,
    });

    expect(decision.overallOutcome).toBe('pass');
    expect(decision.verdicts).toMatchObject([
      { criterionId: 'AC-1', outcome: 'pass', evidenceRefs: [attestation!.id] },
    ]);
    expect(decision.findings).toEqual([]);
    expect(verifyVerificationDecision(decision)).toBe(true);
    expect(verifyVerificationDecision({ ...decision, overallOutcome: 'fail' })).toBe(false);
  });

  it('fails a passing command when verification mutation integrity is blocked', () => {
    const fixture = fixtures();
    const [attestation] = attestations(fixture);
    const mutationAnalysis: VerificationMutationAnalysis = {
      ...fixture.mutationAnalysis,
      decision: 'blocked',
      commandDrift: true,
      findings: [
        {
          id: 'mutation_script',
          path: 'package.json',
          mutationClass: 'command_alias',
          disposition: 'blocked',
          beforeDigest: '3'.repeat(64),
          afterDigest: '4'.repeat(64),
          explanation: 'test alias was weakened',
        },
      ],
    };
    const decision = evaluateCriterionVerdicts({
      id: 'decision_3',
      ...fixture,
      mutationAnalysis,
      attestations: [attestation!],
      createdAt: timestamp,
    });

    expect(decision.overallOutcome).toBe('fail');
    expect(decision.verdicts[0]?.outcome).toBe('fail');
    expect(decision.findings.some((finding) => finding.type === 'verification_mutation')).toBe(
      true,
    );
  });
});

function fixtures() {
  const contract = sealChangeContract(contractInput());
  const specification = sealVerificationSpecification({
    id: 'verification_1',
    taskId: 'task_1',
    contractHash: contract.hash,
    planId: 'plan_1',
    planHash: 'b'.repeat(64),
    version: 1,
    status: 'approved',
    checks: [
      {
        id: 'CHECK-1',
        criterionIds: ['AC-1'],
        required: true,
        description: 'Run deterministic checkout tests.',
        kind: 'command',
        argv: ['pnpm', 'test', '--', 'checkout'],
        timeoutMs: 10_000,
        expectedExitCodes: [0],
      },
    ],
    environment: {
      platform: process.platform,
      architecture: process.arch,
      requiredTools: [{ name: 'node', versionConstraint: '>=24' }],
      network: 'deny',
      networkAllowlist: [],
      environmentVariableAllowlist: [],
      credentialProfileId: 'verifier-profile',
    },
    testMutationPolicy: 'forbid',
    minimumEvidence: [
      {
        id: 'E-1',
        criterionId: 'AC-1',
        evidenceType: 'command_result',
        minimumCount: 1,
        mandatory: true,
      },
    ],
    authoredBy: {
      invocationId: 'test-planner',
      role: 'test_planner',
      providerId: 'provider',
      modelId: 'model',
    },
    approvedBy: { actorId: 'authority', actorType: 'human' },
    approvedAt: timestamp,
  });
  const subject = {
    taskId: 'task_1',
    repositoryId: 'repository_1',
    contractHash: contract.hash,
    planId: specification.planId,
    planHash: specification.planHash,
    verificationSpecificationId: specification.id,
    verificationSpecificationHash: specification.hash,
    baseCommit,
    resultCommit,
  };
  const mutationAnalysis: VerificationMutationAnalysis = {
    baseCommit,
    resultCommit,
    policy: 'forbid',
    decision: 'clear',
    commandDrift: false,
    findings: [],
  };
  return { contract, specification, subject, mutationAnalysis };
}

function attestations(fixture: ReturnType<typeof fixtures>) {
  const environment = {
    platform: process.platform,
    architecture: process.arch,
    toolVersions: { node: process.version },
    environmentVariableDigests: [],
    credentialProfileId: 'verifier-profile',
    networkPolicyDigest: 'c'.repeat(64),
    isolationProvider: 'test-isolator',
    cleanWorktree: true as const,
  };
  const run: DeterministicVerificationRun = {
    specificationHash: fixture.specification.hash,
    resultCommit,
    credentialProfileId: 'verifier-profile',
    networkIsolation: { provider: 'test-isolator', policyDigest: 'c'.repeat(64) },
    environment,
    environmentDigest: sha256Canonical(environment),
    results: [
      {
        checkId: 'CHECK-1',
        criterionIds: ['AC-1'],
        required: true,
        argv: ['pnpm', 'test', '--', 'checkout'],
        cwd: '/clean/worktree',
        status: 'passed',
        exitCode: 0,
        timedOut: false,
        stdoutDigest: 'd'.repeat(64),
        stderrDigest: 'e'.repeat(64),
        startedAt: timestamp,
        completedAt: '2026-07-28T10:00:01.000Z',
        durationMs: 1_000,
      },
    ],
    passed: true,
  };
  return captureVerificationAttestations({
    run,
    specification: fixture.specification,
    repositoryId: 'repository_1',
    baseCommit,
    mutationAnalysis: fixture.mutationAnalysis,
    runnerIdentity: { runnerId: 'runner_1', trustLevel: 'clean_local_runner' },
  });
}

function contractInput(): UnhashedChangeContract {
  return {
    id: 'contract_1',
    taskId: 'task_1',
    projectId: 'project_1',
    repositoryId: 'repository_1',
    version: 1,
    status: 'authorised',
    objective: 'Keep checkout idempotent.',
    acceptanceCriteria: [
      {
        id: 'AC-1',
        statement: 'Repeated checkout creates one order.',
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
        description: 'Independent checkout test.',
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
    authorisedAt: timestamp,
    createdAt: timestamp,
  };
}
