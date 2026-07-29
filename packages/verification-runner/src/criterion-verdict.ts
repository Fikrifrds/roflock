import type { ChangeContract } from '@roleflock/change-contracts';
import { sha256Canonical } from '@roleflock/contracts';
import { z } from 'zod';
import {
  VerificationSubjectSchema,
  verifyVerificationAttestation,
  type VerificationAttestation,
  type VerificationSubject,
} from './attestation.js';
import type { VerificationMutationAnalysis } from './mutation-detector.js';
import type { VerificationCheck, VerificationSpecification } from './index.js';

const IdentifierSchema = z.string().trim().min(1).max(200);
const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const TimestampSchema = z.string().datetime({ offset: true });

export const VerifierFindingSchema = z
  .object({
    id: IdentifierSchema,
    criterionIds: z.array(IdentifierSchema).min(1),
    type: z.enum([
      'deterministic_failure',
      'infrastructure_error',
      'insufficient_evidence',
      'verification_mutation',
      'invalid_attestation',
    ]),
    summary: z.string().trim().min(1),
    evidenceRefs: z.array(IdentifierSchema),
    routedTo: z.literal('planner'),
  })
  .strict();
export type VerifierFinding = z.infer<typeof VerifierFindingSchema>;

export const CriterionVerdictSchema = z
  .object({
    criterionId: IdentifierSchema,
    outcome: z.enum(['pass', 'fail', 'insufficient_evidence', 'not_applicable']),
    evidenceRefs: z.array(IdentifierSchema),
    findingIds: z.array(IdentifierSchema),
    explanation: z.string().trim().min(1),
  })
  .strict();
export type CriterionVerdict = z.infer<typeof CriterionVerdictSchema>;

const VerificationDecisionFields = {
  id: IdentifierSchema,
  taskId: IdentifierSchema,
  subject: VerificationSubjectSchema,
  verdicts: z.array(CriterionVerdictSchema).min(1),
  findings: z.array(VerifierFindingSchema),
  attestationHashes: z.array(DigestSchema),
  mutationAnalysisDigest: DigestSchema,
  ignoredExecutorClaimIds: z.array(IdentifierSchema),
  overallOutcome: z.enum(['pass', 'fail', 'insufficient_evidence']),
  createdAt: TimestampSchema,
} as const;

export const UnhashedVerificationDecisionSchema = z.object(VerificationDecisionFields).strict();
export type UnhashedVerificationDecision = z.infer<typeof UnhashedVerificationDecisionSchema>;

export const VerificationDecisionSchema = z
  .object({
    ...VerificationDecisionFields,
    hashAlgorithm: z.literal('sha256'),
    hash: DigestSchema,
  })
  .strict();
export type VerificationDecision = z.infer<typeof VerificationDecisionSchema>;

export function evaluateCriterionVerdicts(input: {
  id: string;
  contract: ChangeContract;
  specification: Readonly<VerificationSpecification>;
  subject: VerificationSubject;
  attestations: VerificationAttestation[];
  mutationAnalysis: VerificationMutationAnalysis;
  executorClaims?: Array<{ id: string; criterionIds: string[]; claimedOutcome: 'pass' | 'fail' }>;
  createdAt?: string;
}): VerificationDecision {
  assertEvaluationBindings(input);
  const validAttestations = input.attestations.filter(
    (attestation) =>
      verifyVerificationAttestation(attestation) &&
      sha256Canonical(attestation.subject) === sha256Canonical(input.subject),
  );
  const invalidAttestations = input.attestations.filter(
    (attestation) => !validAttestations.includes(attestation),
  );
  const findings: VerifierFinding[] = [];
  const verdicts = input.contract.acceptanceCriteria.map((criterion) => {
    const relevantChecks = input.specification.checks.filter((check) =>
      check.criterionIds.includes(criterion.id),
    );
    const relevantAttestations = validAttestations.filter((attestation) =>
      attestation.criterionIds.includes(criterion.id),
    );
    const criterionFindings: VerifierFinding[] = [];

    if (input.mutationAnalysis.decision !== 'clear') {
      criterionFindings.push(
        finding(
          criterion.id,
          'verification_mutation',
          `Verification mutation policy is ${input.mutationAnalysis.decision}`,
          input.mutationAnalysis.findings.map((item) => item.id),
        ),
      );
    }
    for (const attestation of invalidAttestations.filter((item) =>
      item.criterionIds.includes(criterion.id),
    )) {
      criterionFindings.push(
        finding(
          criterion.id,
          'invalid_attestation',
          `Attestation ${attestation.id} is invalid or bound to another subject`,
          [attestation.id],
        ),
      );
    }
    const failed = relevantAttestations.filter((item) => item.outcome === 'fail');
    if (failed.length > 0) {
      criterionFindings.push(
        finding(
          criterion.id,
          'deterministic_failure',
          `Required deterministic evidence failed for ${criterion.id}`,
          failed.map((item) => item.id),
        ),
      );
    }
    const infrastructure = relevantAttestations.filter((item) =>
      ['error', 'timeout', 'unknown'].includes(item.outcome),
    );
    if (infrastructure.length > 0) {
      criterionFindings.push(
        finding(
          criterion.id,
          'infrastructure_error',
          `Verification infrastructure did not produce a PASS for ${criterion.id}`,
          infrastructure.map((item) => item.id),
        ),
      );
    }

    const missingRequirements = input.specification.minimumEvidence.filter(
      (requirement) =>
        requirement.criterionId === criterion.id &&
        requirement.mandatory &&
        countPassingEvidence(requirement.evidenceType, relevantChecks, relevantAttestations) <
          requirement.minimumCount,
    );
    const requiredChecksWithoutPass = relevantChecks.filter(
      (check) =>
        check.required &&
        !relevantAttestations.some(
          (attestation) => attestation.checkId === check.id && attestation.outcome === 'pass',
        ),
    );
    if (missingRequirements.length > 0 || requiredChecksWithoutPass.length > 0) {
      criterionFindings.push(
        finding(
          criterion.id,
          'insufficient_evidence',
          `Mandatory independent evidence is missing for ${criterion.id}`,
          [
            ...missingRequirements.map((requirement) => requirement.id),
            ...requiredChecksWithoutPass.map((check) => check.id),
          ],
        ),
      );
    }
    findings.push(...criterionFindings);

    const outcome: CriterionVerdict['outcome'] = criterionFindings.some((item) =>
      ['deterministic_failure', 'verification_mutation', 'invalid_attestation'].includes(item.type),
    )
      ? 'fail'
      : criterionFindings.length > 0
        ? 'insufficient_evidence'
        : 'pass';
    return CriterionVerdictSchema.parse({
      criterionId: criterion.id,
      outcome,
      evidenceRefs: relevantAttestations.map((attestation) => attestation.id),
      findingIds: criterionFindings.map((item) => item.id),
      explanation:
        outcome === 'pass'
          ? 'All mandatory evidence was produced by a clean runner for the same immutable subject.'
          : outcome === 'fail'
            ? 'Independent evidence or verification integrity failed.'
            : 'No independent failure was proven, but mandatory evidence is incomplete.',
    });
  });

  const overallOutcome = verdicts.some((verdict) => verdict.outcome === 'fail')
    ? 'fail'
    : verdicts.every((verdict) => verdict.outcome === 'pass')
      ? 'pass'
      : 'insufficient_evidence';
  const decision = UnhashedVerificationDecisionSchema.parse({
    id: input.id,
    taskId: input.contract.taskId,
    subject: input.subject,
    verdicts,
    findings,
    attestationHashes: validAttestations.map((attestation) => attestation.hash).sort(),
    mutationAnalysisDigest: sha256Canonical(input.mutationAnalysis),
    ignoredExecutorClaimIds: (input.executorClaims ?? []).map((claim) => claim.id).sort(),
    overallOutcome,
    createdAt: input.createdAt ?? new Date().toISOString(),
  });
  return VerificationDecisionSchema.parse({
    ...decision,
    hashAlgorithm: 'sha256',
    hash: sha256Canonical(decision),
  });
}

export function verifyVerificationDecision(decision: VerificationDecision): boolean {
  const parsed = VerificationDecisionSchema.parse(decision);
  const { hash, hashAlgorithm: _hashAlgorithm, ...unhashed } = parsed;
  return hash === sha256Canonical(UnhashedVerificationDecisionSchema.parse(unhashed));
}

function assertEvaluationBindings(input: {
  contract: ChangeContract;
  specification: Readonly<VerificationSpecification>;
  subject: VerificationSubject;
  mutationAnalysis: VerificationMutationAnalysis;
}): void {
  if (
    input.contract.status !== 'authorised' ||
    input.contract.hash !== input.specification.contractHash ||
    input.subject.contractHash !== input.contract.hash ||
    input.subject.planId !== input.specification.planId ||
    input.subject.planHash !== input.specification.planHash ||
    input.subject.verificationSpecificationId !== input.specification.id ||
    input.subject.verificationSpecificationHash !== input.specification.hash ||
    input.subject.baseCommit !== input.mutationAnalysis.baseCommit ||
    input.subject.resultCommit !== input.mutationAnalysis.resultCommit
  ) {
    throw new Error('Criterion evaluation inputs do not share one immutable subject');
  }
}

function countPassingEvidence(
  evidenceType: VerificationSpecification['minimumEvidence'][number]['evidenceType'],
  checks: VerificationCheck[],
  attestations: VerificationAttestation[],
): number {
  const eligibleCheckIds = new Set(
    checks.filter((check) => evidenceTypeFor(check) === evidenceType).map((check) => check.id),
  );
  return attestations.filter(
    (attestation) => attestation.outcome === 'pass' && eligibleCheckIds.has(attestation.checkId),
  ).length;
}

function evidenceTypeFor(
  check: VerificationCheck,
): VerificationSpecification['minimumEvidence'][number]['evidenceType'] | undefined {
  if (check.kind === 'command') return 'command_result';
  if (check.kind === 'static_analysis') return 'static_analysis';
  if (check.kind === 'security_scan') return 'security_scan';
  if (check.kind === 'diff_policy') return 'diff_observation';
  if (check.kind === 'manual_review') return 'manual_attestation';
  return check.kind === 'test_selector' ? 'test_result' : undefined;
}

function finding(
  criterionId: string,
  type: VerifierFinding['type'],
  summary: string,
  evidenceRefs: string[],
): VerifierFinding {
  return VerifierFindingSchema.parse({
    id: `finding_${sha256Canonical({ criterionId, type, summary, evidenceRefs }).slice(0, 24)}`,
    criterionIds: [criterionId],
    type,
    summary,
    evidenceRefs,
    routedTo: 'planner',
  });
}
