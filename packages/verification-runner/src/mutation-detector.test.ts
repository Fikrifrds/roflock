import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sealVerificationSpecification } from './index.js';
import { detectVerificationMutations, runMutationAwareVerification } from './mutation-detector.js';

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe('verification mutation detector', () => {
  it('blocks weakened tests and changed command aliases under forbid', async () => {
    const fixture = repositoryFixture();
    const analysis = await detectVerificationMutations({
      repositoryRoot: fixture.repository,
      baseCommit: fixture.baseCommit,
      resultCommit: fixture.resultCommit,
      policy: 'forbid',
    });

    expect(analysis.decision).toBe('blocked');
    expect(analysis.commandDrift).toBe(true);
    expect(analysis.findings).toMatchObject([
      {
        path: 'package.json',
        mutationClass: 'command_alias',
        disposition: 'blocked',
      },
      {
        path: 'tests/checkout.test.ts',
        mutationClass: 'test',
        disposition: 'blocked',
      },
    ]);
    expect(analysis.findings.every((finding) => finding.beforeDigest !== finding.afterDigest)).toBe(
      true,
    );
  });

  it('requires review or an exact planned path without hiding command drift', async () => {
    const fixture = repositoryFixture();
    const review = await detectVerificationMutations({
      repositoryRoot: fixture.repository,
      baseCommit: fixture.baseCommit,
      resultCommit: fixture.resultCommit,
      policy: 'review',
    });
    expect(review.decision).toBe('review_required');
    expect(review.findings.every((finding) => finding.disposition === 'review_required')).toBe(
      true,
    );

    const planned = await detectVerificationMutations({
      repositoryRoot: fixture.repository,
      baseCommit: fixture.baseCommit,
      resultCommit: fixture.resultCommit,
      policy: 'allow_planned',
      plannedPaths: ['tests/checkout.test.ts'],
    });
    expect(planned.decision).toBe('blocked');
    expect(planned.findings.find((finding) => finding.path.startsWith('tests/'))?.disposition).toBe(
      'allowed_planned',
    );
    expect(planned.findings.find((finding) => finding.path === 'package.json')?.disposition).toBe(
      'blocked',
    );
    expect(planned.commandDrift).toBe(true);
  });

  it('ignores package metadata edits when command aliases are unchanged', async () => {
    const repository = initialiseRepository();
    writeFileSync(
      join(repository, 'package.json'),
      JSON.stringify({ version: '1.0.0', scripts: { test: 'vitest run' } }, null, 2),
    );
    git(repository, ['add', '.']);
    git(repository, ['commit', '-m', 'base']);
    const baseCommit = git(repository, ['rev-parse', 'HEAD']);
    writeFileSync(
      join(repository, 'package.json'),
      JSON.stringify({ version: '1.0.1', scripts: { test: 'vitest run' } }, null, 2),
    );
    git(repository, ['add', '.']);
    git(repository, ['commit', '-m', 'metadata']);
    const resultCommit = git(repository, ['rev-parse', 'HEAD']);

    const analysis = await detectVerificationMutations({
      repositoryRoot: repository,
      baseCommit,
      resultCommit,
      policy: 'forbid',
    });
    expect(analysis).toMatchObject({ decision: 'clear', commandDrift: false, findings: [] });
  });

  it('cannot report assurance PASS when a weakened command alias would pass', async () => {
    const fixture = repositoryFixture();
    const specification = sealVerificationSpecification({
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
          description: 'A command that independently exits successfully.',
          kind: 'command',
          argv: [process.execPath, '-e', 'process.exit(0)'],
          timeoutMs: 10_000,
          expectedExitCodes: [0],
        },
      ],
      environment: {
        platform: process.platform,
        architecture: process.arch,
        requiredTools: [{ name: 'node', versionConstraint: process.version }],
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
      approvedAt: '2026-07-28T10:00:00.000Z',
    });

    const run = await runMutationAwareVerification({
      specification,
      expectedSpecificationHash: specification.hash,
      baseCommit: fixture.baseCommit,
      worktree: {
        path: fixture.repository,
        repositoryRoot: fixture.repository,
        resultCommit: fixture.resultCommit,
        runId: 'mutation-aware-run',
        createdAt: '2026-07-28T10:00:00.000Z',
      },
      networkIsolation: {
        async enforce() {
          return { provider: 'test-isolator', policyDigest: 'd'.repeat(64) };
        },
      },
    });

    expect(run.results[0]?.status).toBe('passed');
    expect(run.mutationAnalysis.commandDrift).toBe(true);
    expect(run.passed).toBe(false);
  });
});

function repositoryFixture(): {
  repository: string;
  baseCommit: string;
  resultCommit: string;
} {
  const repository = initialiseRepository();
  mkdirSync(join(repository, 'tests'));
  writeFileSync(
    join(repository, 'package.json'),
    JSON.stringify({ scripts: { test: 'vitest run --coverage' } }, null, 2),
  );
  writeFileSync(
    join(repository, 'tests/checkout.test.ts'),
    'expect(createOrderTwice()).toHaveLength(1);\n',
  );
  git(repository, ['add', '.']);
  git(repository, ['commit', '-m', 'base']);
  const baseCommit = git(repository, ['rev-parse', 'HEAD']);

  writeFileSync(
    join(repository, 'package.json'),
    JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }, null, 2),
  );
  writeFileSync(join(repository, 'tests/checkout.test.ts'), 'expect(true).toBe(true);\n');
  git(repository, ['add', '.']);
  git(repository, ['commit', '-m', 'weaken verification']);
  return {
    repository,
    baseCommit,
    resultCommit: git(repository, ['rev-parse', 'HEAD']),
  };
}

function initialiseRepository(): string {
  const repository = mkdtempSync(join(tmpdir(), 'roleflock-mutation-detector-'));
  directories.push(repository);
  git(repository, ['init']);
  git(repository, ['config', 'user.email', 'test@roleflock.local']);
  git(repository, ['config', 'user.name', 'RoleFlock Test']);
  return repository;
}

function git(directory: string, args: string[]): string {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
}
