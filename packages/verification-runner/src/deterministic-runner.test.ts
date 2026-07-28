import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  runDeterministicVerification,
  sealVerificationSpecification,
  type NetworkIsolationProvider,
  type UnhashedVerificationSpecification,
} from './index.js';
import type { CleanVerifierWorktree } from './verifier-worktree.js';

const directories: string[] = [];
const approvedAt = '2026-07-28T10:00:00.000Z';

afterEach(async () => {
  delete process.env.ROLEFLOCK_WRITER_SECRET;
  while (directories.length > 0) await rm(directories.pop()!, { recursive: true, force: true });
});

describe('restricted deterministic verifier', () => {
  it('preserves exact argv while excluding ambient writer credentials', async () => {
    const worktree = await temporaryWorktree();
    const payload = '; touch should-not-exist && echo $ROLEFLOCK_WRITER_SECRET';
    const specification = sealVerificationSpecification(
      specificationInput([
        {
          id: 'CHECK-1',
          criterionIds: ['AC-1'],
          required: true,
          description: 'Inspect literal arguments and restricted environment.',
          kind: 'command',
          argv: [
            process.execPath,
            '-e',
            'process.stdout.write(JSON.stringify({arg:process.argv[1],secret:process.env.ROLEFLOCK_WRITER_SECRET??"absent",safe:process.env.SAFE_SETTING}))',
            payload,
          ],
          timeoutMs: 10_000,
          expectedExitCodes: [0],
        },
      ]),
    );
    process.env.ROLEFLOCK_WRITER_SECRET = 'must-not-leak';
    const networkRequests: unknown[] = [];

    const run = await runDeterministicVerification({
      specification,
      expectedSpecificationHash: specification.hash,
      worktree,
      sourceEnvironment: {
        SAFE_SETTING: 'approved',
        ROLEFLOCK_WRITER_SECRET: 'must-not-leak',
      },
      writerCredentialProfileId: 'writer-profile',
      networkIsolation: isolation(networkRequests),
    });

    expect(run.passed).toBe(true);
    expect(run.results[0]?.argv.at(-1)).toBe(payload);
    expect(run.results[0]?.stdoutDigest).toBe(
      digest(JSON.stringify({ arg: payload, secret: 'absent', safe: 'approved' })),
    );
    expect(networkRequests).toEqual([
      { worktreePath: worktree.path, policy: 'deny', allowlist: [] },
    ]);
  });

  it('records missing required commands as failed instead of skipped', async () => {
    const worktree = await temporaryWorktree();
    const specification = sealVerificationSpecification(
      specificationInput([
        {
          id: 'CHECK-MISSING',
          criterionIds: ['AC-1'],
          required: true,
          description: 'A required tool must exist.',
          kind: 'static_analysis',
          argv: ['roleflock-command-that-does-not-exist'],
          timeoutMs: 10_000,
          expectedExitCodes: [0],
        },
      ]),
    );

    const run = await runDeterministicVerification({
      specification,
      expectedSpecificationHash: specification.hash,
      worktree,
      networkIsolation: isolation([]),
    });

    expect(run.passed).toBe(false);
    expect(run.results).toMatchObject([
      {
        checkId: 'CHECK-MISSING',
        required: true,
        status: 'failed',
        exitCode: null,
      },
    ]);
    expect(run.results[0]?.failureReason).toMatch(/ENOENT|not exist/i);
  });

  it('fails closed for shared credentials, ambient secrets, and invalid isolation receipts', async () => {
    const worktree = await temporaryWorktree();
    const specification = sealVerificationSpecification(specificationInput());
    const base = {
      specification,
      expectedSpecificationHash: specification.hash,
      worktree,
      networkIsolation: isolation([]),
    };

    await expect(
      runDeterministicVerification({
        ...base,
        writerCredentialProfileId: specification.environment.credentialProfileId,
      }),
    ).rejects.toThrow(/independent from the writer/);

    const secretSpecification = sealVerificationSpecification({
      ...specificationInput(),
      environment: {
        ...specificationInput().environment,
        environmentVariableAllowlist: ['API_TOKEN'],
      },
    });
    await expect(
      runDeterministicVerification({
        ...base,
        specification: secretSpecification,
        expectedSpecificationHash: secretSpecification.hash,
        sourceEnvironment: { API_TOKEN: 'writer-token' },
      }),
    ).rejects.toThrow(/cannot be inherited/);

    await expect(
      runDeterministicVerification({
        ...base,
        networkIsolation: {
          async enforce() {
            return { provider: '', policyDigest: 'invalid' };
          },
        },
      }),
    ).rejects.toThrow(/invalid enforcement receipt/);
  });
});

function specificationInput(
  checks: UnhashedVerificationSpecification['checks'] = [
    {
      id: 'CHECK-1',
      criterionIds: ['AC-1'],
      required: true,
      description: 'Run a deterministic check.',
      kind: 'command',
      argv: [process.execPath, '-e', 'process.exit(0)'],
      timeoutMs: 10_000,
      expectedExitCodes: [0],
    },
  ],
): UnhashedVerificationSpecification {
  return {
    id: 'verification_1',
    taskId: 'task_1',
    contractHash: 'a'.repeat(64),
    planId: 'plan_1',
    planHash: 'b'.repeat(64),
    version: 1,
    status: 'approved',
    checks,
    environment: {
      platform: process.platform,
      architecture: process.arch,
      requiredTools: [{ name: 'node', versionConstraint: process.version }],
      network: 'deny',
      networkAllowlist: [],
      environmentVariableAllowlist: ['SAFE_SETTING'],
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
  };
}

async function temporaryWorktree(): Promise<CleanVerifierWorktree> {
  const path = await mkdtemp(join(tmpdir(), 'roleflock-restricted-verifier-'));
  directories.push(path);
  return {
    path,
    repositoryRoot: path,
    resultCommit: 'c'.repeat(40),
    runId: 'verification-run-1',
    createdAt: approvedAt,
  };
}

function isolation(requests: unknown[]): NetworkIsolationProvider {
  return {
    async enforce(request) {
      requests.push(request);
      return { provider: 'test-isolator', policyDigest: digest(JSON.stringify(request)) };
    },
  };
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
