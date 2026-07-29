import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ChangeContract, ExecutionPlan } from '@roleflock/change-contracts';
import { sha256Canonical } from '@roleflock/contracts';
import {
  captureVerificationAttestations,
  createCleanVerifierWorktree,
  evaluateCriterionVerdicts,
  removeCleanVerifierWorktree,
  runMutationAwareVerification,
  VerificationSubjectSchema,
  type NetworkIsolationProvider,
  type RunnerIdentityReference,
  type VerificationAttestation,
  type VerificationDecision,
  type VerificationMutationAnalysis,
  type VerificationSpecification,
  type VerificationSubject,
} from '@roleflock/verification-runner';

const exec = promisify(execFile);

/**
 * The writer's credential profile. Named explicitly so the deterministic runner
 * can refuse a verification specification that reuses it: a verifier holding
 * the writer's credentials is not an independent verifier.
 */
export const WRITER_CREDENTIAL_PROFILE_ID = 'roleflock.writer.local';

export type NetworkEnforcement = 'enforced' | 'unenforced';

export interface IndependentVerificationOutcome {
  decision: VerificationDecision;
  attestations: VerificationAttestation[];
  mutationAnalysis: VerificationMutationAnalysis;
  subject: VerificationSubject;
  networkEnforcement: NetworkEnforcement;
  isolationProvider: string;
}

/**
 * Reports the network isolation this host actually applied.
 *
 * RoleFlock has no privileged network sandbox on a developer workstation, and
 * the honest consequence is that it says so: the receipt names an unenforced
 * provider, that name is hashed into the environment capture of every
 * attestation, and the passport carries a matching non-blocking risk. Returning
 * a confident-sounding provider name here would put a false isolation claim
 * inside signed evidence, which is the one thing this pipeline exists to
 * prevent.
 */
export function createNetworkIsolationProvider(): NetworkIsolationProvider & {
  enforcement: NetworkEnforcement;
} {
  return {
    enforcement: 'unenforced',
    async enforce(request) {
      return {
        provider: 'roleflock.unenforced_local',
        policyDigest: sha256Canonical({
          policy: request.policy,
          allowlist: [...request.allowlist].sort(),
          enforcement: 'unenforced',
        }),
      };
    },
  };
}

/**
 * Runs the frozen verification specification against the sealed result commit
 * in a clean worktree the executor never touched, then turns the raw run into
 * criterion verdicts.
 *
 * Nothing the executor claimed is an input here. The verdicts are derived only
 * from attestations this function produced.
 */
export async function runIndependentVerification(input: {
  specification: Readonly<VerificationSpecification>;
  contract: ChangeContract;
  plan: ExecutionPlan;
  repositoryRoot: string;
  repositoryId: string;
  verifierBaseDirectory: string;
  runId: string;
  baseCommit: string;
  resultCommit: string;
  runnerIdentity: RunnerIdentityReference;
  decisionId: string;
}): Promise<IndependentVerificationOutcome> {
  const isolation = createNetworkIsolationProvider();
  const worktree = await createCleanVerifierWorktree({
    repositoryRoot: input.repositoryRoot,
    resultCommit: input.resultCommit,
    baseDirectory: input.verifierBaseDirectory,
    runId: input.runId,
  });

  try {
    const run = await runMutationAwareVerification({
      specification: input.specification,
      worktree,
      expectedSpecificationHash: input.specification.hash,
      networkIsolation: isolation,
      baseCommit: input.baseCommit,
      plannedVerificationMutationPaths: [...input.plan.expectedChangedPaths],
      // The verifier inherits no writer environment at all. Only the
      // infrastructure variables the runner adds itself survive.
      sourceEnvironment: {},
      writerCredentialProfileId: WRITER_CREDENTIAL_PROFILE_ID,
      resolvedToolVersions: await resolveToolVersions(input.specification, worktree.path),
    });

    const attestations = captureVerificationAttestations({
      run,
      specification: input.specification,
      repositoryId: input.repositoryId,
      baseCommit: input.baseCommit,
      mutationAnalysis: run.mutationAnalysis,
      runnerIdentity: input.runnerIdentity,
    });

    const subject = VerificationSubjectSchema.parse({
      taskId: input.specification.taskId,
      repositoryId: input.repositoryId,
      contractHash: input.specification.contractHash,
      planId: input.specification.planId,
      planHash: input.specification.planHash,
      verificationSpecificationId: input.specification.id,
      verificationSpecificationHash: input.specification.hash,
      baseCommit: input.baseCommit,
      resultCommit: run.resultCommit,
    });

    const decision = evaluateCriterionVerdicts({
      id: input.decisionId,
      contract: input.contract,
      specification: input.specification,
      subject,
      attestations,
      mutationAnalysis: run.mutationAnalysis,
    });

    return {
      decision,
      attestations,
      mutationAnalysis: run.mutationAnalysis,
      subject,
      networkEnforcement: isolation.enforcement,
      isolationProvider: run.environment.isolationProvider,
    };
  } finally {
    await removeCleanVerifierWorktree(worktree, input.verifierBaseDirectory).catch(() => {});
  }
}

/**
 * Resolves the concrete version of every tool the frozen specification
 * requires, so the attestation records what actually ran rather than what was
 * assumed. A tool that cannot be resolved fails the run instead of being
 * recorded as unknown.
 */
async function resolveToolVersions(
  specification: Readonly<VerificationSpecification>,
  cwd: string,
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    specification.environment.requiredTools.map(async ({ name }) => {
      if (name.toLowerCase() === 'node') return [name, process.version] as const;
      try {
        const { stdout } = await exec(name, ['--version'], {
          cwd,
          encoding: 'utf8',
          timeout: 30_000,
          maxBuffer: 1024 * 1024,
        });
        const version = stdout.trim().split('\n')[0]?.trim();
        if (!version) throw new Error('empty version output');
        return [name, version] as const;
      } catch (error) {
        throw new Error(
          `Required verification tool is unavailable: ${name} (${
            error instanceof Error ? error.message : String(error)
          })`,
          { cause: error },
        );
      }
    }),
  );
  return Object.fromEntries(entries);
}
