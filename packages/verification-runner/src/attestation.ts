import { sha256Canonical } from '@roleflock/contracts';
import { z } from 'zod';
import type {
  DeterministicVerificationRun,
  VerificationCommandResult,
} from './deterministic-runner.js';
import type { VerificationSpecification } from './index.js';
import type { VerificationMutationAnalysis } from './mutation-detector.js';

const IdentifierSchema = z.string().trim().min(1).max(200);
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const CommitSchema = z.string().regex(/^[a-f0-9]{7,64}$/);
const TimestampSchema = z.string().datetime({ offset: true });

export const VerificationSubjectSchema = z
  .object({
    taskId: IdentifierSchema,
    repositoryId: IdentifierSchema,
    contractHash: DigestSchema,
    planId: IdentifierSchema,
    planHash: DigestSchema,
    verificationSpecificationId: IdentifierSchema,
    verificationSpecificationHash: DigestSchema,
    baseCommit: CommitSchema,
    resultCommit: CommitSchema,
  })
  .strict();
export type VerificationSubject = z.infer<typeof VerificationSubjectSchema>;

export const RunnerIdentityReferenceSchema = z
  .object({
    runnerId: IdentifierSchema,
    trustLevel: z.enum(['clean_local_runner', 'organisation_trusted_runner']),
    keyId: IdentifierSchema.optional(),
  })
  .strict()
  .superRefine((identity, context) => {
    if (identity.trustLevel === 'organisation_trusted_runner' && !identity.keyId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['keyId'],
        message: 'Organisation-trusted runners require a registered key identity',
      });
    }
  });
export type RunnerIdentityReference = z.infer<typeof RunnerIdentityReferenceSchema>;

const VerificationAttestationFields = {
  id: IdentifierSchema,
  subject: VerificationSubjectSchema,
  checkId: IdentifierSchema,
  criterionIds: z.array(IdentifierSchema).min(1),
  commandDigest: DigestSchema,
  environmentDigest: DigestSchema,
  networkPolicyDigest: DigestSchema,
  mutationAnalysisDigest: DigestSchema,
  startedAt: TimestampSchema,
  completedAt: TimestampSchema,
  durationMs: z.number().int().nonnegative(),
  outcome: z.enum(['pass', 'fail', 'error', 'timeout', 'unknown']),
  exitCode: z.number().int().nullable(),
  logDigests: z.array(DigestSchema).length(2),
  artifactDigests: z.array(DigestSchema),
  runnerIdentity: RunnerIdentityReferenceSchema,
} as const;

function validateAttestation(
  attestation: z.infer<z.ZodObject<typeof VerificationAttestationFields>>,
  context: z.RefinementCtx,
): void {
  if (Date.parse(attestation.completedAt) < Date.parse(attestation.startedAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['completedAt'],
      message: 'Attestation completion cannot precede its start',
    });
  }
  if (attestation.outcome === 'pass' && attestation.exitCode === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['exitCode'],
      message: 'PASS requires a concrete exit code',
    });
  }
}

export const UnhashedVerificationAttestationSchema = z
  .object(VerificationAttestationFields)
  .strict()
  .superRefine(validateAttestation);
export type UnhashedVerificationAttestation = z.infer<typeof UnhashedVerificationAttestationSchema>;

export const VerificationAttestationSchema = z
  .object({
    ...VerificationAttestationFields,
    hashAlgorithm: z.literal('sha256'),
    hash: DigestSchema,
  })
  .strict()
  .superRefine(validateAttestation);
export type VerificationAttestation = z.infer<typeof VerificationAttestationSchema>;

export function captureVerificationAttestations(input: {
  run: DeterministicVerificationRun;
  specification: Readonly<VerificationSpecification>;
  repositoryId: string;
  baseCommit: string;
  mutationAnalysis: VerificationMutationAnalysis;
  runnerIdentity: RunnerIdentityReference;
  artifactDigestsByCheck?: Record<string, string[]>;
}): VerificationAttestation[] {
  assertRunBinding(input);
  const subject = VerificationSubjectSchema.parse({
    taskId: input.specification.taskId,
    repositoryId: input.repositoryId,
    contractHash: input.specification.contractHash,
    planId: input.specification.planId,
    planHash: input.specification.planHash,
    verificationSpecificationId: input.specification.id,
    verificationSpecificationHash: input.specification.hash,
    baseCommit: input.baseCommit,
    resultCommit: input.run.resultCommit,
  });
  const mutationAnalysisDigest = sha256Canonical(input.mutationAnalysis);
  return input.run.results.map((result) =>
    sealAttestation({
      id: attestationId(subject, result),
      subject,
      checkId: result.checkId,
      criterionIds: result.criterionIds,
      commandDigest: sha256Canonical(result.argv),
      environmentDigest: input.run.environmentDigest,
      networkPolicyDigest: input.run.networkIsolation.policyDigest,
      mutationAnalysisDigest,
      startedAt: result.startedAt,
      completedAt: result.completedAt,
      durationMs: result.durationMs,
      outcome: outcomeFor(result),
      exitCode: result.exitCode,
      logDigests: [result.stdoutDigest, result.stderrDigest],
      artifactDigests: input.artifactDigestsByCheck?.[result.checkId] ?? [],
      runnerIdentity: RunnerIdentityReferenceSchema.parse(input.runnerIdentity),
    }),
  );
}

export function verifyVerificationAttestation(attestation: VerificationAttestation): boolean {
  const parsed = VerificationAttestationSchema.parse(attestation);
  const { hash, hashAlgorithm: _hashAlgorithm, ...unhashed } = parsed;
  return hash === sha256Canonical(UnhashedVerificationAttestationSchema.parse(unhashed));
}

function sealAttestation(input: UnhashedVerificationAttestation): VerificationAttestation {
  const attestation = UnhashedVerificationAttestationSchema.parse(input);
  return VerificationAttestationSchema.parse({
    ...attestation,
    hashAlgorithm: 'sha256',
    hash: sha256Canonical(attestation),
  });
}

function assertRunBinding(input: {
  run: DeterministicVerificationRun;
  specification: Readonly<VerificationSpecification>;
  mutationAnalysis: VerificationMutationAnalysis;
  baseCommit: string;
}): void {
  if (input.run.specificationHash !== input.specification.hash) {
    throw new Error('Verification run is not bound to the supplied specification');
  }
  if (
    input.run.credentialProfileId !== input.specification.environment.credentialProfileId ||
    input.run.environment.credentialProfileId !==
      input.specification.environment.credentialProfileId
  ) {
    throw new Error('Verification run used a credential profile outside the frozen specification');
  }
  if (
    input.mutationAnalysis.baseCommit !== input.baseCommit ||
    input.mutationAnalysis.resultCommit !== input.run.resultCommit
  ) {
    throw new Error('Mutation analysis is not bound to the verification subject commits');
  }
  if (input.run.environment.networkPolicyDigest !== input.run.networkIsolation.policyDigest) {
    throw new Error('Environment capture is not bound to the network isolation receipt');
  }
  if (sha256Canonical(input.run.environment) !== input.run.environmentDigest) {
    throw new Error('Verification environment capture digest is invalid');
  }
  for (const result of input.run.results) {
    const check = input.specification.checks.find((candidate) => candidate.id === result.checkId);
    if (
      !check ||
      !('argv' in check) ||
      sha256Canonical(check.argv) !== sha256Canonical(result.argv) ||
      sha256Canonical(check.criterionIds) !== sha256Canonical(result.criterionIds)
    ) {
      throw new Error(`Verification result drifted from frozen check: ${result.checkId}`);
    }
  }
}

function outcomeFor(result: VerificationCommandResult): VerificationAttestation['outcome'] {
  if (result.timedOut) return 'timeout';
  if (result.exitCode === null) return 'error';
  return result.status === 'passed' ? 'pass' : 'fail';
}

function attestationId(subject: VerificationSubject, result: VerificationCommandResult): string {
  return `attestation_${sha256Canonical({
    subject,
    checkId: result.checkId,
    startedAt: result.startedAt,
  }).slice(0, 24)}`;
}
