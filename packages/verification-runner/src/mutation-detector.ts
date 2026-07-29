import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { relative } from 'node:path';
import { promisify } from 'node:util';
import type { TestMutationPolicy } from './index.js';
import {
  runDeterministicVerification,
  type DeterministicVerificationRun,
  type DeterministicVerifierInput,
} from './deterministic-runner.js';

const exec = promisify(execFile);
const CommitSchema = /^[a-f0-9]{7,64}$/;

export type VerificationMutationClass =
  | 'test'
  | 'command_alias'
  | 'ci_configuration'
  | 'verification_helper'
  | 'snapshot_or_fixture'
  | 'policy_configuration';

export interface VerificationMutationFinding {
  id: string;
  path: string;
  mutationClass: VerificationMutationClass;
  disposition: 'blocked' | 'review_required' | 'allowed_planned';
  beforeDigest: string | null;
  afterDigest: string | null;
  explanation: string;
}

export interface VerificationMutationAnalysis {
  baseCommit: string;
  resultCommit: string;
  policy: TestMutationPolicy;
  decision: 'clear' | 'blocked' | 'review_required';
  commandDrift: boolean;
  findings: VerificationMutationFinding[];
}

export interface MutationAwareVerificationRun extends DeterministicVerificationRun {
  mutationAnalysis: VerificationMutationAnalysis;
}

export async function runMutationAwareVerification(
  input: DeterministicVerifierInput & {
    baseCommit: string;
    plannedVerificationMutationPaths?: string[];
  },
): Promise<MutationAwareVerificationRun> {
  const mutationAnalysis = await detectVerificationMutations({
    repositoryRoot: input.worktree.repositoryRoot,
    baseCommit: input.baseCommit,
    resultCommit: input.worktree.resultCommit,
    policy: input.specification.testMutationPolicy,
    plannedPaths: input.plannedVerificationMutationPaths,
  });
  const run = await runDeterministicVerification(input);
  return {
    ...run,
    mutationAnalysis,
    passed: run.passed && mutationAnalysis.decision === 'clear',
  };
}

export async function detectVerificationMutations(input: {
  repositoryRoot: string;
  baseCommit: string;
  resultCommit: string;
  policy: TestMutationPolicy;
  plannedPaths?: string[];
}): Promise<VerificationMutationAnalysis> {
  assertCommit(input.baseCommit, 'base');
  assertCommit(input.resultCommit, 'result');
  const root = await realpath(input.repositoryRoot);
  const [baseCommit, resultCommit] = await Promise.all([
    resolveCommit(root, input.baseCommit),
    resolveCommit(root, input.resultCommit),
  ]);
  const changedPaths = await diffPaths(root, baseCommit, resultCommit);
  const plannedPaths = new Set((input.plannedPaths ?? []).map(normalisePlanPath));
  const findings: VerificationMutationFinding[] = [];

  for (const path of changedPaths) {
    const mutationClass = await classifyMutation(root, baseCommit, resultCommit, path);
    if (!mutationClass) continue;
    const [before, after] = await Promise.all([
      readAtCommit(root, baseCommit, path),
      readAtCommit(root, resultCommit, path),
    ]);
    const disposition = dispositionFor(input.policy, plannedPaths.has(path));
    findings.push({
      id: findingId(path, mutationClass, before, after),
      path,
      mutationClass,
      disposition,
      beforeDigest: before === null ? null : digest(before),
      afterDigest: after === null ? null : digest(after),
      explanation: explanationFor(path, mutationClass, disposition),
    });
  }

  return {
    baseCommit,
    resultCommit,
    policy: input.policy,
    decision: findings.some((finding) => finding.disposition === 'blocked')
      ? 'blocked'
      : findings.some((finding) => finding.disposition === 'review_required')
        ? 'review_required'
        : 'clear',
    commandDrift: findings.some((finding) => finding.mutationClass === 'command_alias'),
    findings,
  };
}

async function classifyMutation(
  root: string,
  baseCommit: string,
  resultCommit: string,
  path: string,
): Promise<VerificationMutationClass | null> {
  const lower = path.toLowerCase();
  if (isPackageManifest(lower)) {
    const [before, after] = await Promise.all([
      readAtCommit(root, baseCommit, path),
      readAtCommit(root, resultCommit, path),
    ]);
    return scriptDigest(before) === scriptDigest(after) ? null : 'command_alias';
  }
  if (
    lower.startsWith('.github/workflows/') ||
    lower === '.gitlab-ci.yml' ||
    lower.startsWith('.circleci/') ||
    lower.startsWith('ci/')
  ) {
    return 'ci_configuration';
  }
  if (
    /(?:^|\/)(?:__snapshots__|snapshots?|fixtures?)(?:\/|$)/.test(lower) ||
    /\.(?:snap|fixture)\.[^/]+$/.test(lower)
  ) {
    return 'snapshot_or_fixture';
  }
  if (
    /(?:^|\/)(?:verify|verification|verifier|test-utils?|test_helpers?)(?:[./_-]|$)/.test(lower)
  ) {
    return 'verification_helper';
  }
  if (
    /(?:^|\/)(?:tests?|__tests__)(?:\/|$)/.test(lower) ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(lower)
  ) {
    return 'test';
  }
  if (
    /(?:^|\/)(?:roleflock|verification|quality|security)(?:[._-].*)?\.(?:json|ya?ml|toml)$/.test(
      lower,
    )
  ) {
    return 'policy_configuration';
  }
  return null;
}

function dispositionFor(
  policy: TestMutationPolicy,
  exactlyPlanned: boolean,
): VerificationMutationFinding['disposition'] {
  if (policy === 'forbid') return 'blocked';
  if (policy === 'review') return 'review_required';
  return exactlyPlanned ? 'allowed_planned' : 'blocked';
}

function explanationFor(
  path: string,
  mutationClass: VerificationMutationClass,
  disposition: VerificationMutationFinding['disposition'],
): string {
  if (disposition === 'allowed_planned') {
    return `${mutationClass} mutation is explicitly planned at ${path}`;
  }
  if (disposition === 'review_required') {
    return `${mutationClass} mutation at ${path} requires independent approval`;
  }
  return `${mutationClass} mutation at ${path} is not permitted by the frozen verification policy`;
}

async function diffPaths(
  root: string,
  baseCommit: string,
  resultCommit: string,
): Promise<string[]> {
  const { stdout } = await exec(
    'git',
    ['-C', root, 'diff', '--name-only', '-z', baseCommit, resultCommit, '--'],
    { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 },
  );
  return stdout.toString('utf8').split('\0').filter(Boolean).map(normalisePlanPath).sort();
}

async function resolveCommit(root: string, commit: string): Promise<string> {
  const { stdout } = await exec(
    'git',
    ['-C', root, 'rev-parse', '--verify', `${commit}^{commit}`],
    {
      encoding: 'utf8',
    },
  );
  return stdout.trim();
}

async function readAtCommit(root: string, commit: string, path: string): Promise<string | null> {
  try {
    const { stdout } = await exec('git', ['-C', root, 'show', `${commit}:${path}`], {
      encoding: 'buffer',
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.toString('utf8');
  } catch {
    return null;
  }
}

function scriptDigest(content: string | null): string {
  if (content === null) return 'missing';
  try {
    const parsed = JSON.parse(content) as { scripts?: unknown };
    return digest(JSON.stringify(sortObject(parsed.scripts)));
  } catch {
    return `invalid:${digest(content)}`;
  }
}

function sortObject(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value ?? null;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}

function isPackageManifest(path: string): boolean {
  return /(?:^|\/)package\.json$/.test(path);
}

function normalisePlanPath(path: string): string {
  const normalised = path.replaceAll('\\', '/').replace(/^\.\/+/, '');
  if (!normalised || normalised.startsWith('/') || relative('.', normalised).startsWith('..')) {
    throw new Error(`Unsafe verification mutation path: ${path}`);
  }
  return normalised;
}

function assertCommit(commit: string, label: string): void {
  if (!CommitSchema.test(commit)) throw new Error(`${label} commit is invalid`);
}

function findingId(
  path: string,
  mutationClass: VerificationMutationClass,
  before: string | null,
  after: string | null,
): string {
  return `mutation_${digest(JSON.stringify([path, mutationClass, before, after])).slice(0, 24)}`;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
