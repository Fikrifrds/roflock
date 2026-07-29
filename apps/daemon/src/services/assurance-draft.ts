import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ChangeContract, ExecutionPlan } from '@roleflock/change-contracts';
import { parseCommandArgv } from '@roleflock/command-runner';
import { discoverVerificationCommand } from './verification-command.js';
import { WRITER_CREDENTIAL_PROFILE_ID } from './independent-verification.js';

const exec = promisify(execFile);

/** Directories a plan should never hand to an executor by default. */
const EXCLUDED_ROOTS = new Set(['node_modules', 'dist', 'build', 'coverage', '.git']);

export const DERIVED_VERIFICATION_SPEC_ID = 'verification_1';

export interface AssuranceDraft {
  plan: Record<string, unknown>;
  /** Absent when the repository offers no command to verify with. */
  verificationCommand: string | undefined;
  allowedPaths: string[];
}

/**
 * Derives a proposable Execution Plan from an authorised contract.
 *
 * This is a starting point a human approves, not a planner substitute: every
 * step maps to a criterion the contract already states, and the path scope
 * comes from what the repository actually tracks. Nothing here invents intent
 * the contract did not already carry.
 */
export async function draftExecutionPlan(input: {
  contract: ChangeContract;
  repositoryRoot: string;
  verificationCommand?: string | undefined;
}): Promise<AssuranceDraft> {
  const allowedPaths = await trackedTopLevelPaths(input.repositoryRoot);
  const verificationCommand =
    input.verificationCommand?.trim() || (await discoverVerificationCommand(input.repositoryRoot));
  const evidenceIds = input.contract.requiredEvidence.map((evidence) => evidence.id);

  return {
    allowedPaths,
    verificationCommand,
    plan: {
      summary: `Deliver the authorised outcome: ${input.contract.objective}`,
      assumptions: [],
      steps: input.contract.acceptanceCriteria.map((criterion, index) => ({
        id: `STEP-${index + 1}`,
        objective: criterion.statement,
        criterionIds: [criterion.id],
        allowedOperations: ['modify_file', 'run_command'],
        expectedFiles: allowedPaths,
        completionEvidenceIds: criterion.requiredEvidenceIds?.length
          ? [...criterion.requiredEvidenceIds]
          : evidenceIds,
      })),
      allowedPaths,
      expectedChangedPaths: allowedPaths,
      forbiddenPaths: [],
      dependencyChanges: [],
      migrationActions: [],
      verificationSpecId: DERIVED_VERIFICATION_SPEC_ID,
      repairEnvelope: {
        allowedFailureClasses: ['formatting', 'lint_autofix'],
        maxAttempts: 1,
        mayAddFiles: false,
        mayChangeDependencies: false,
        mayChangePublicApi: false,
        mayChangeSchema: false,
        pathScope: allowedPaths,
      },
      changeBudget: {
        maxChangedFiles: 40,
        maxAddedLines: 2000,
        maxDeletedLines: 2000,
        maxNewDependencies: 0,
      },
      decisionLog: [],
    },
  };
}

export interface VerificationSpecificationDraft {
  checks: Array<Record<string, unknown>>;
  environment: Record<string, unknown>;
  testMutationPolicy: 'forbid' | 'review' | 'allow_planned';
  minimumEvidence: Array<Record<string, unknown>>;
}

/**
 * Derives the frozen verification specification for an approved plan.
 *
 * One deterministic command check per acceptance criterion, run under a
 * credential profile that is explicitly not the writer's — the runner refuses
 * anything else, which is the point.
 */
export function draftVerificationSpecification(input: {
  contract: ChangeContract;
  plan: ExecutionPlan;
  verificationCommand: string;
}): VerificationSpecificationDraft {
  const argv = parseCommandArgv(input.verificationCommand);
  if (argv.length === 0) throw new Error('Verification command is empty');

  return {
    checks: input.contract.acceptanceCriteria.map((criterion, index) => ({
      id: `CHK-${index + 1}`,
      kind: 'command',
      criterionIds: [criterion.id],
      required: true,
      description: `Deterministic evidence for ${criterion.id}: ${criterion.statement}`,
      argv,
      timeoutMs: 900_000,
      expectedExitCodes: [0],
    })),
    environment: {
      platform: process.platform,
      architecture: process.arch,
      requiredTools: requiredTools(argv[0]!),
      network: 'deny',
      networkAllowlist: [],
      environmentVariableAllowlist: [],
      credentialProfileId: verifierCredentialProfileId(),
    },
    testMutationPolicy: 'forbid',
    minimumEvidence: input.contract.acceptanceCriteria.map((criterion, index) => ({
      id: `REQ-${index + 1}`,
      criterionId: criterion.id,
      evidenceType: 'command_result',
      minimumCount: 1,
      mandatory: true,
    })),
  };
}

/**
 * Distinct from {@link WRITER_CREDENTIAL_PROFILE_ID} by construction — the
 * deterministic runner refuses a verifier that shares the writer's credentials,
 * and the two literals are typed so a future edit that collapses them fails to
 * compile rather than silently weakening verifier independence.
 */
export function verifierCredentialProfileId(): Exclude<
  'roleflock.verifier.local',
  typeof WRITER_CREDENTIAL_PROFILE_ID
> {
  return 'roleflock.verifier.local';
}

/**
 * The tools whose versions the attestation must record. Resolution happens in
 * the runner; naming the wrong tool here fails the run rather than silently
 * recording nothing.
 */
function requiredTools(command: string): Array<{ name: string; versionConstraint: string }> {
  const name = command.split('/').pop() ?? command;
  if (name === process.execPath.split('/').pop() || name === 'node') {
    return [{ name: 'node', versionConstraint: '*' }];
  }
  return [{ name, versionConstraint: '*' }];
}

async function trackedTopLevelPaths(repositoryRoot: string): Promise<string[]> {
  try {
    const { stdout } = await exec('git', ['-C', repositoryRoot, 'ls-files', '-z'], {
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
    });
    const roots = new Set<string>();
    for (const path of stdout.toString('utf8').split('\0')) {
      if (!path) continue;
      const head = path.split('/')[0]!;
      if (head.startsWith('.') || EXCLUDED_ROOTS.has(head)) continue;
      roots.add(head);
    }
    // A repository with nothing but dotfiles still needs a scope the schema
    // accepts, and the plan must not silently widen to the whole tree.
    return roots.size > 0 ? [...roots].sort() : ['README.md'];
  } catch {
    return ['README.md'];
  }
}
