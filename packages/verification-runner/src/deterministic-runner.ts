import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { CommandError, runCommand } from '@roleflock/command-runner';
import { sha256Canonical } from '@roleflock/contracts';
import type { VerificationCheck, VerificationSpecification } from './index.js';
import type { CleanVerifierWorktree } from './verifier-worktree.js';

const commandKinds = new Set(['command', 'static_analysis', 'security_scan']);
const prohibitedAmbientVariables =
  /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE_KEY|ACCESS_KEY|SESSION|COOKIE|CREDENTIALS?)(?:_|$)/i;
const infrastructureVariables = new Set([
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'COMSPEC',
  'TMPDIR',
  'TMP',
  'TEMP',
]);

export interface NetworkIsolationRequest {
  worktreePath: string;
  policy: 'deny' | 'allowlist';
  allowlist: string[];
}

export interface NetworkIsolationReceipt {
  provider: string;
  policyDigest: string;
}

export interface NetworkIsolationProvider {
  enforce(request: NetworkIsolationRequest): Promise<NetworkIsolationReceipt>;
}

export interface CredentialEnvironmentRequest {
  profileId: string;
  allowedVariables: string[];
}

export interface CredentialEnvironmentProvider {
  resolve(request: CredentialEnvironmentRequest): Promise<NodeJS.ProcessEnv>;
}

export interface DeterministicVerifierInput {
  specification: Readonly<VerificationSpecification>;
  worktree: CleanVerifierWorktree;
  expectedSpecificationHash: string;
  networkIsolation: NetworkIsolationProvider;
  sourceEnvironment?: NodeJS.ProcessEnv;
  infrastructureEnvironment?: NodeJS.ProcessEnv;
  credentialEnvironment?: CredentialEnvironmentProvider;
  writerCredentialProfileId?: string;
}

export interface VerificationCommandResult {
  checkId: string;
  criterionIds: string[];
  required: boolean;
  argv: string[];
  cwd: string;
  status: 'passed' | 'failed';
  exitCode: number | null;
  timedOut: boolean;
  stdoutDigest: string;
  stderrDigest: string;
  failureReason?: string;
}

export interface DeterministicVerificationRun {
  specificationHash: string;
  resultCommit: string;
  credentialProfileId: string;
  networkIsolation: NetworkIsolationReceipt;
  results: VerificationCommandResult[];
  passed: boolean;
}

export async function runDeterministicVerification(
  input: DeterministicVerifierInput,
): Promise<DeterministicVerificationRun> {
  assertRunnableInput(input);
  const isolation = await input.networkIsolation.enforce({
    worktreePath: input.worktree.path,
    policy: input.specification.environment.network,
    allowlist: [...input.specification.environment.networkAllowlist],
  });
  if (!isolation.provider.trim() || !/^[a-f0-9]{64}$/.test(isolation.policyDigest)) {
    throw new Error('Network isolation provider returned an invalid enforcement receipt');
  }

  const env = await buildRestrictedEnvironment(input);
  const results: VerificationCommandResult[] = [];
  for (const check of input.specification.checks) {
    if (!isCommandCheck(check)) continue;
    results.push(await executeCheck(check, input.worktree, env));
  }

  return {
    specificationHash: input.specification.hash,
    resultCommit: input.worktree.resultCommit,
    credentialProfileId: input.specification.environment.credentialProfileId,
    networkIsolation: isolation,
    results,
    passed: results.every((result) => result.status === 'passed' || !result.required),
  };
}

function assertRunnableInput(input: DeterministicVerifierInput): void {
  const { hash, hashAlgorithm: _hashAlgorithm, ...unhashed } = input.specification;
  if (hash !== input.expectedSpecificationHash || hash !== sha256Canonical(unhashed)) {
    throw new Error('Verification Specification hash changed before execution');
  }
  if (
    input.writerCredentialProfileId &&
    input.writerCredentialProfileId === input.specification.environment.credentialProfileId
  ) {
    throw new Error('Verifier credential profile must be independent from the writer');
  }
  if (
    input.specification.environment.platform !== process.platform ||
    input.specification.environment.architecture !== process.arch
  ) {
    throw new Error(
      `Verifier environment mismatch: expected ${input.specification.environment.platform}/${input.specification.environment.architecture}, received ${process.platform}/${process.arch}`,
    );
  }
  if (!input.networkIsolation?.enforce) {
    throw new Error('A fail-closed network isolation provider is required');
  }
}

async function buildRestrictedEnvironment(
  input: DeterministicVerifierInput,
): Promise<NodeJS.ProcessEnv> {
  const env: NodeJS.ProcessEnv = { CI: 'true', ROLEFLOCK_VERIFICATION: '1' };
  const infrastructure = input.infrastructureEnvironment ?? process.env;
  for (const name of infrastructureVariables) {
    if (infrastructure[name] !== undefined) env[name] = infrastructure[name];
  }

  const allowedVariables = input.specification.environment.environmentVariableAllowlist;
  const source = input.sourceEnvironment ?? {};
  for (const name of allowedVariables) {
    if (source[name] !== undefined && prohibitedAmbientVariables.test(name)) {
      throw new Error(
        `Credential-like variable cannot be inherited from writer environment: ${name}`,
      );
    }
    if (source[name] !== undefined) env[name] = source[name];
  }

  if (input.credentialEnvironment) {
    const credentials = await input.credentialEnvironment.resolve({
      profileId: input.specification.environment.credentialProfileId,
      allowedVariables: [...allowedVariables],
    });
    for (const [name, value] of Object.entries(credentials)) {
      if (!allowedVariables.includes(name)) {
        throw new Error(`Credential profile returned a variable outside the allowlist: ${name}`);
      }
      if (value !== undefined) env[name] = value;
    }
  }
  return env;
}

async function executeCheck(
  check: Extract<VerificationCheck, { kind: 'command' | 'static_analysis' | 'security_scan' }>,
  worktree: CleanVerifierWorktree,
  env: NodeJS.ProcessEnv,
): Promise<VerificationCommandResult> {
  const [command, ...args] = check.argv;
  const cwd = check.cwd ? resolve(worktree.path, check.cwd) : worktree.path;
  try {
    const result = await runCommand({
      command: command!,
      args,
      cwd,
      sandboxRoot: worktree.path,
      timeoutMs: check.timeoutMs,
      env,
      inheritEnv: false,
    });
    const passed = result.exitCode !== null && check.expectedExitCodes.includes(result.exitCode);
    return resultFor(
      check,
      cwd,
      result.exitCode,
      result.timedOut,
      result.stdout,
      result.stderr,
      passed,
    );
  } catch (error) {
    if (error instanceof CommandError) {
      const passed =
        error.result.exitCode !== null &&
        !error.result.timedOut &&
        check.expectedExitCodes.includes(error.result.exitCode);
      return resultFor(
        check,
        cwd,
        error.result.exitCode,
        error.result.timedOut,
        error.result.stdout,
        error.result.stderr,
        passed,
        passed ? undefined : error.message,
      );
    }
    return resultFor(check, cwd, null, false, '', String(error), false, errorMessage(error));
  }
}

function resultFor(
  check: Extract<VerificationCheck, { kind: 'command' | 'static_analysis' | 'security_scan' }>,
  cwd: string,
  exitCode: number | null,
  timedOut: boolean,
  stdout: string,
  stderr: string,
  passed: boolean,
  failureReason?: string,
): VerificationCommandResult {
  return {
    checkId: check.id,
    criterionIds: [...check.criterionIds],
    required: check.required,
    argv: [...check.argv],
    cwd,
    status: passed ? 'passed' : 'failed',
    exitCode,
    timedOut,
    stdoutDigest: digest(stdout),
    stderrDigest: digest(stderr),
    ...(failureReason ? { failureReason } : {}),
  };
}

function isCommandCheck(
  check: VerificationCheck,
): check is Extract<VerificationCheck, { kind: 'command' | 'static_analysis' | 'security_scan' }> {
  return commandKinds.has(check.kind);
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
