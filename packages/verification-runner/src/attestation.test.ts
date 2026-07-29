import { sha256Canonical } from '@roleflock/contracts';
import { describe, expect, it } from 'vitest';
import {
  captureVerificationAttestations,
  sealVerificationSpecification,
  verifyVerificationAttestation,
  type DeterministicVerificationRun,
  type VerificationMutationAnalysis,
} from './index.js';

const approvedAt = '2026-07-28T10:00:00.000Z';

describe('verification attestation capture', () => {
  it('binds subject, command, environment, mutation, and output digests', () => {
    const specification = specificationFixture();
    const environment = {
      platform: process.platform,
      architecture: process.arch,
      toolVersions: { node: process.version },
      environmentVariableDigests: [
        { name: 'CI', valueDigest: sha256Canonical('true') },
        { name: 'DATABASE_TOKEN', valueDigest: sha256Canonical('redacted-value') },
      ],
      credentialProfileId: 'verifier-profile',
      networkPolicyDigest: 'c'.repeat(64),
      isolationProvider: 'sandbox-test',
      cleanWorktree: true as const,
    };
    const run: DeterministicVerificationRun = {
      specificationHash: specification.hash,
      resultCommit: '2'.repeat(40),
      credentialProfileId: 'verifier-profile',
      networkIsolation: { provider: 'sandbox-test', policyDigest: 'c'.repeat(64) },
      environment,
      environmentDigest: sha256Canonical(environment),
      results: [
        {
          checkId: 'CHECK-1',
          criterionIds: ['AC-1'],
          required: true,
          argv: ['pnpm', 'test', '--', 'checkout'],
          cwd: '/verifier/worktree',
          status: 'passed',
          exitCode: 0,
          timedOut: false,
          stdoutDigest: 'd'.repeat(64),
          stderrDigest: 'e'.repeat(64),
          startedAt: approvedAt,
          completedAt: '2026-07-28T10:00:01.250Z',
          durationMs: 1_250,
        },
      ],
      passed: true,
    };
    const mutationAnalysis = mutationFixture();

    const [attestation] = captureVerificationAttestations({
      run,
      specification,
      repositoryId: 'repository_1',
      baseCommit: '1'.repeat(40),
      mutationAnalysis,
      runnerIdentity: {
        runnerId: 'local_runner_1',
        trustLevel: 'clean_local_runner',
      },
      artifactDigestsByCheck: { 'CHECK-1': ['f'.repeat(64)] },
    });

    expect(attestation).toMatchObject({
      subject: {
        repositoryId: 'repository_1',
        contractHash: specification.contractHash,
        planHash: specification.planHash,
        verificationSpecificationHash: specification.hash,
        baseCommit: '1'.repeat(40),
        resultCommit: '2'.repeat(40),
      },
      checkId: 'CHECK-1',
      commandDigest: sha256Canonical(run.results[0]!.argv),
      environmentDigest: run.environmentDigest,
      networkPolicyDigest: run.networkIsolation.policyDigest,
      mutationAnalysisDigest: sha256Canonical(mutationAnalysis),
      outcome: 'pass',
      logDigests: ['d'.repeat(64), 'e'.repeat(64)],
      artifactDigests: ['f'.repeat(64)],
      runnerIdentity: { trustLevel: 'clean_local_runner' },
    });
    expect(verifyVerificationAttestation(attestation!)).toBe(true);
    expect(
      verifyVerificationAttestation({
        ...attestation!,
        subject: { ...attestation!.subject, resultCommit: '3'.repeat(40) },
      }),
    ).toBe(false);
  });

  it('rejects mismatched subject and environment captures', () => {
    const specification = specificationFixture();
    const environment = {
      platform: process.platform,
      architecture: process.arch,
      toolVersions: { node: process.version },
      environmentVariableDigests: [],
      credentialProfileId: 'verifier-profile',
      networkPolicyDigest: 'c'.repeat(64),
      isolationProvider: 'sandbox-test',
      cleanWorktree: true as const,
    };
    const run: DeterministicVerificationRun = {
      specificationHash: specification.hash,
      resultCommit: '2'.repeat(40),
      credentialProfileId: 'verifier-profile',
      networkIsolation: { provider: 'sandbox-test', policyDigest: 'c'.repeat(64) },
      environment,
      environmentDigest: 'f'.repeat(64),
      results: [],
      passed: true,
    };
    expect(() =>
      captureVerificationAttestations({
        run,
        specification,
        repositoryId: 'repository_1',
        baseCommit: '1'.repeat(40),
        mutationAnalysis: mutationFixture(),
        runnerIdentity: {
          runnerId: 'local_runner_1',
          trustLevel: 'clean_local_runner',
        },
      }),
    ).toThrow(/environment capture digest/);
  });
});

function specificationFixture() {
  return sealVerificationSpecification({
    id: 'verification_1',
    taskId: 'task_1',
    contractHash: 'a'.repeat(64),
    planId: 'plan_1',
    planHash: 'b'.repeat(64),
    version: 1,
    status: 'approved',
    checks: [
      {
        id: 'CHECK-1',
        criterionIds: ['AC-1'],
        required: true,
        description: 'Run checkout tests.',
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
      environmentVariableAllowlist: ['CI'],
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
    approvedAt,
  });
}

function mutationFixture(): VerificationMutationAnalysis {
  return {
    baseCommit: '1'.repeat(40),
    resultCommit: '2'.repeat(40),
    policy: 'forbid',
    decision: 'clear',
    commandDrift: false,
    findings: [],
  };
}
