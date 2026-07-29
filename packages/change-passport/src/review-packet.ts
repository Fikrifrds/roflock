import { z } from 'zod';
import type { ChangePassportPayload } from './index.js';
import type { RunnerIdentity } from './signing.js';

const IdentifierSchema = z.string().trim().min(1);

export const ReviewPacketSchema = z
  .object({
    passportId: IdentifierSchema,
    taskId: IdentifierSchema,
    subject: z
      .object({
        repositoryId: IdentifierSchema,
        baseCommit: IdentifierSchema,
        resultCommit: IdentifierSchema,
        treeDigest: IdentifierSchema,
        diffDigest: IdentifierSchema,
      })
      .strict(),
    verdict: z.enum(['pass', 'fail', 'conditional', 'revoked']),
    criteria: z.array(
      z
        .object({
          criterionId: IdentifierSchema,
          outcome: z.enum(['pass', 'fail', 'insufficient_evidence', 'not_applicable']),
          explanation: z.string(),
          evidenceCount: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    evidence: z
      .object({
        executionAttestations: z.number().int().nonnegative(),
        verificationAttestations: z.number().int().nonnegative(),
        availability: z.enum(['complete', 'partial', 'digest_only']),
      })
      .strict(),
    assurance: z
      .object({
        issuerTrust: z.enum(['local_self', 'organisation', 'external']),
        issuerTrustLabel: z.enum([
          'Local self-attestation',
          'Organisation-trusted attestation',
          'External attestation',
        ]),
        verification: z.string(),
        execution: z.string(),
        independence: z.array(z.string()),
        runnerIdentityId: IdentifierSchema,
        keyId: IdentifierSchema,
      })
      .strict(),
    approvals: z.number().int().nonnegative(),
    openBlockingDeviations: z.number().int().nonnegative(),
    unresolvedRisks: z.array(
      z
        .object({
          id: IdentifierSchema,
          summary: z.string(),
          severity: z.string(),
          blocking: z.boolean(),
        })
        .strict(),
    ),
    caveats: z.array(z.string()),
    issuedAt: z.string(),
    expiresAt: z.string().optional(),
  })
  .strict();
export type ReviewPacket = z.infer<typeof ReviewPacketSchema>;

export function buildReviewPacket(input: {
  payload: ChangePassportPayload;
  issuerIdentity: RunnerIdentity;
  decision?: {
    verdicts: Array<{
      criterionId: string;
      outcome: 'pass' | 'fail' | 'insufficient_evidence' | 'not_applicable';
      evidenceRefs: string[];
      explanation: string;
    }>;
  };
}): ReviewPacket {
  const { payload, issuerIdentity } = input;
  const caveats: string[] = [];
  if (payload.assurance.issuerTrust === 'local_self') {
    caveats.push(
      'Signed by this local installation. The workstation owner remains inside the trust boundary.',
    );
  }
  if (payload.assurance.evidenceAvailability !== 'complete') {
    caveats.push(
      `Evidence availability is ${payload.assurance.evidenceAvailability.replaceAll('_', ' ')}.`,
    );
  }
  if (payload.assurance.verification === 'executor_claim_only') {
    caveats.push('No independent verification attestation is present.');
  }
  if (!input.decision) {
    caveats.push('Criterion-level verification decision is unavailable in this review view.');
  }

  return ReviewPacketSchema.parse({
    passportId: payload.passportId,
    taskId: payload.taskId,
    subject: {
      repositoryId: payload.subject.repositoryId,
      baseCommit: payload.subject.baseCommit,
      resultCommit: payload.subject.resultCommit,
      treeDigest: payload.subject.treeDigest,
      diffDigest: payload.subject.diffDigest,
    },
    verdict: payload.verdict,
    criteria:
      input.decision?.verdicts.map((verdict) => ({
        criterionId: verdict.criterionId,
        outcome: verdict.outcome,
        explanation: verdict.explanation,
        evidenceCount: verdict.evidenceRefs.length,
      })) ?? [],
    evidence: {
      executionAttestations: payload.executionAttestations.length,
      verificationAttestations: payload.verificationAttestations.length,
      availability: payload.assurance.evidenceAvailability,
    },
    assurance: {
      issuerTrust: payload.assurance.issuerTrust,
      issuerTrustLabel: trustLabel(payload.assurance.issuerTrust),
      verification: payload.assurance.verification,
      execution: payload.assurance.execution,
      independence: payload.assurance.verifierIndependence,
      runnerIdentityId: issuerIdentity.id,
      keyId: issuerIdentity.keyId,
    },
    approvals: payload.approvals.length,
    openBlockingDeviations: payload.deviations.filter(
      (deviation) => deviation.blocking && deviation.status === 'open',
    ).length,
    unresolvedRisks: payload.unresolvedRisks.map((risk) => ({
      id: risk.id,
      summary: risk.summary,
      severity: risk.severity,
      blocking: risk.blocking,
    })),
    caveats,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
  });
}

function trustLabel(
  trust: ChangePassportPayload['assurance']['issuerTrust'],
): ReviewPacket['assurance']['issuerTrustLabel'] {
  if (trust === 'local_self') return 'Local self-attestation';
  if (trust === 'organisation') return 'Organisation-trusted attestation';
  return 'External attestation';
}
