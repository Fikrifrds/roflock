import { sha256Canonical } from '@roleflock/contracts';
import { z } from 'zod';

const Id = z.string().trim().min(1).max(240);
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Commit = z.string().regex(/^[a-f0-9]{40,64}$/);
const Timestamp = z.string().datetime({ offset: true });

export const OutcomeObservationSchema = z
  .object({
    schemaVersion: z.literal(1),
    observationId: Id,
    taskId: Id,
    taskClass: z
      .object({
        taskType: Id,
        risk: z.enum(['low', 'medium', 'high', 'critical']),
        repositorySizeBucket: z.enum(['small', 'medium', 'large', 'very_large']),
        languageMix: z.array(Id),
        signals: z.array(Id),
      })
      .strict(),
    roleAssignment: z
      .object({
        roleId: Id,
        assignmentId: Id,
        providerId: Id,
        modelId: Id,
        modelFamily: Id.optional(),
        effort: Id.optional(),
        profileVersion: Id,
        routingPolicyVersion: Id,
        recommendationId: Id.optional(),
      })
      .strict(),
    authority: z
      .object({
        contractHash: Digest,
        planHash: Digest,
        resultCommit: Commit,
      })
      .strict(),
    outcome: z
      .object({
        status: z.enum(['accepted', 'rejected', 'failed', 'cancelled']),
        planAcceptedFirstPass: z.boolean().optional(),
        verificationPassedFirstPass: z.boolean().optional(),
        executionAdherence: z.number().min(0).max(1).optional(),
        deviationCount: z.number().int().nonnegative(),
        interventionCount: z.number().int().nonnegative(),
        latencyMs: z.number().int().nonnegative(),
        actualCostUsd: z.number().nonnegative().optional(),
        inputTokens: z.number().int().nonnegative().optional(),
        outputTokens: z.number().int().nonnegative().optional(),
      })
      .strict(),
    evidence: z
      .object({
        passportId: Id.optional(),
        verificationResultId: Id.optional(),
        metricsDigest: Digest,
      })
      .strict(),
    source: z.enum(['automatic', 'human_reported', 'post_merge']),
    excluded: z.boolean(),
    exclusionReason: z.string().trim().min(1).optional(),
    observedAt: Timestamp,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.excluded !== Boolean(value.exclusionReason)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['exclusionReason'],
        message: 'Excluded observations require a reason and included observations cannot have one',
      });
    }
  });
export type OutcomeObservation = z.infer<typeof OutcomeObservationSchema>;

export interface SealedOutcomeObservation extends OutcomeObservation {
  digestAlgorithm: 'sha256';
  observationDigest: string;
}

export function sealOutcomeObservation(
  input: OutcomeObservation,
): SealedOutcomeObservation {
  const observation = OutcomeObservationSchema.parse(input);
  return {
    ...observation,
    digestAlgorithm: 'sha256',
    observationDigest: sha256Canonical(observation),
  };
}

export function verifyOutcomeObservation(value: SealedOutcomeObservation): boolean {
  const { observationDigest, digestAlgorithm: _algorithm, ...observation } = value;
  return (
    observationDigest ===
    sha256Canonical(OutcomeObservationSchema.parse(observation))
  );
}
