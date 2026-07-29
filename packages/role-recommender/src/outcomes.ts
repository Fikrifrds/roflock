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

export function sealOutcomeObservation(input: OutcomeObservation): SealedOutcomeObservation {
  const observation = OutcomeObservationSchema.parse(input);
  return {
    ...observation,
    digestAlgorithm: 'sha256',
    observationDigest: sha256Canonical(observation),
  };
}

export function verifyOutcomeObservation(value: SealedOutcomeObservation): boolean {
  const { observationDigest, digestAlgorithm: _algorithm, ...observation } = value;
  return observationDigest === sha256Canonical(OutcomeObservationSchema.parse(observation));
}

export interface NormalizedTaskClass {
  normalizerVersion: '1.0.0';
  key: string;
  dimensions: {
    taskType: string;
    risk: OutcomeObservation['taskClass']['risk'];
    repositorySizeBucket: OutcomeObservation['taskClass']['repositorySizeBucket'];
    languageMix: string[];
    signals: string[];
  };
  confidence: number;
  unknownDimensions: string[];
}

export function normalizeTaskClass(input: OutcomeObservation['taskClass']): NormalizedTaskClass {
  const dimensions = {
    taskType: input.taskType.trim().toLowerCase(),
    risk: input.risk,
    repositorySizeBucket: input.repositorySizeBucket,
    languageMix: [...new Set(input.languageMix.map(normalizeLabel))].sort(),
    signals: [...new Set(input.signals.map(normalizeLabel))].sort(),
  };
  const unknownDimensions: string[] = [];
  if (dimensions.languageMix.length === 0) unknownDimensions.push('languageMix');
  if (dimensions.signals.length === 0) unknownDimensions.push('signals');
  const confidence = (5 - unknownDimensions.length) / 5;
  return {
    normalizerVersion: '1.0.0',
    key: sha256Canonical(dimensions),
    dimensions,
    confidence,
    unknownDimensions,
  };
}

export function taskClassCompatibility(
  left: NormalizedTaskClass,
  right: NormalizedTaskClass,
): { compatible: boolean; score: number; reasons: string[] } {
  const reasons: string[] = [];
  if (left.dimensions.taskType !== right.dimensions.taskType) reasons.push('task_type');
  if (left.dimensions.risk !== right.dimensions.risk) reasons.push('risk');
  if (left.dimensions.repositorySizeBucket !== right.dimensions.repositorySizeBucket) {
    reasons.push('repository_size');
  }
  const languageScore = jaccard(left.dimensions.languageMix, right.dimensions.languageMix);
  const signalScore = jaccard(left.dimensions.signals, right.dimensions.signals);
  if (languageScore < 0.5) reasons.push('language_mix');
  if (signalScore < 0.5) reasons.push('domain_signals');
  const exactScore =
    1 -
    Math.min(
      3,
      reasons.filter((reason) => ['task_type', 'risk', 'repository_size'].includes(reason)).length,
    ) /
      3;
  const score = Number((exactScore * 0.6 + languageScore * 0.2 + signalScore * 0.2).toFixed(6));
  return {
    compatible: reasons.length === 0 && Math.min(left.confidence, right.confidence) >= 0.8,
    score,
    reasons,
  };
}

export const PostMergeOutcomeSchema = z
  .object({
    schemaVersion: z.literal(1),
    postMergeOutcomeId: Id,
    observationId: Id,
    taskId: Id,
    passportId: Id.optional(),
    resultCommit: Commit,
    outcomeType: z.enum(['healthy', 'rollback', 'escaped_defect']),
    severity: z.enum(['none', 'low', 'medium', 'high', 'critical']),
    reportDigest: Digest,
    sourceReferenceDigest: Digest.optional(),
    reportedBy: Id,
    detectedAt: Timestamp,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.outcomeType === 'healthy' && value.severity !== 'none') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['severity'],
        message: 'Healthy outcomes must have severity none',
      });
    }
    if (value.outcomeType !== 'healthy' && value.severity === 'none') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['severity'],
        message: 'Rollback and escaped defects require a non-none severity',
      });
    }
  });
export type PostMergeOutcome = z.infer<typeof PostMergeOutcomeSchema>;

export interface SealedPostMergeOutcome extends PostMergeOutcome {
  digestAlgorithm: 'sha256';
  outcomeDigest: string;
}

export function sealPostMergeOutcome(input: PostMergeOutcome): SealedPostMergeOutcome {
  const outcome = PostMergeOutcomeSchema.parse(input);
  return {
    ...outcome,
    digestAlgorithm: 'sha256',
    outcomeDigest: sha256Canonical(outcome),
  };
}

export function postMergeFailurePenalty(outcomes: readonly PostMergeOutcome[]): {
  penalty: number;
  failures: number;
  reason: string;
} {
  const weights = { none: 0, low: 0.1, medium: 0.25, high: 0.5, critical: 1 };
  const failures = outcomes.filter((outcome) => outcome.outcomeType !== 'healthy');
  const penalty = Math.min(
    1,
    failures.reduce((total, outcome) => total + weights[outcome.severity], 0) /
      Math.max(1, outcomes.length),
  );
  return {
    penalty: Number(penalty.toFixed(6)),
    failures: failures.length,
    reason:
      failures.length > 0
        ? `${failures.length} rollback or escaped-defect event(s) observed post-merge.`
        : 'No rollback or escaped defect has been reported.',
  };
}

function normalizeLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.+#_-]+/g, '_');
}

function jaccard(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const a = new Set(left);
  const b = new Set(right);
  const intersection = [...a].filter((value) => b.has(value)).length;
  return intersection / new Set([...a, ...b]).size;
}
