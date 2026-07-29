import type { RoleRequirementProfile } from './hard-constraints.js';
import type { IndependenceDecision } from './independence.js';
import { effectiveTraitScore, type ModelCapabilityProfile, type ModelTrait } from './index.js';
import type { HardConstraintDecision } from './hard-constraints.js';

export const ROLE_SCORING_VERSION = 'rolefit-1.0.0';

export interface RoleScoringConfig {
  scoringVersion: string;
  unknownOptionalTraitPenalty: number;
  preferredIndependencePenalty: number;
  minimumObservedSamples: number;
  minimumObservedConfidence: number;
  costPenalty: Record<'free' | 'low' | 'medium' | 'high' | 'unknown', number>;
  latencyPenalty: Record<'fast' | 'medium' | 'slow' | 'unknown', number>;
}

export const DEFAULT_ROLE_SCORING_CONFIG: RoleScoringConfig = {
  scoringVersion: ROLE_SCORING_VERSION,
  unknownOptionalTraitPenalty: 0.025,
  preferredIndependencePenalty: 0.04,
  minimumObservedSamples: 5,
  minimumObservedConfidence: 0.25,
  costPenalty: { free: 0, low: 0.01, medium: 0.03, high: 0.07, unknown: 0.05 },
  latencyPenalty: { fast: 0, medium: 0.01, slow: 0.03, unknown: 0.02 },
};

export interface RoleScoringCandidate {
  profile: ModelCapabilityProfile;
  hardConstraintDecision: HardConstraintDecision;
  independenceDecision?: IndependenceDecision;
  availabilityConfidence: number;
  organisationPreference?: number;
  observedVerifiedSuccess?: {
    score: number;
    confidence: number;
    sampleSize: number;
  };
  recentFailurePenalty?: number;
}

export interface RoleCandidateScore {
  rank: number;
  providerId: string;
  modelId: string;
  modelFamily?: string;
  role: RoleRequirementProfile['role'];
  scoringVersion: string;
  profileVersion: string;
  eligible: true;
  score: number;
  confidence: number;
  constraintConfidence: number;
  observedSuccessConfidence: number;
  expectedCostClass: 'free' | 'low' | 'medium' | 'high' | 'unknown';
  expectedLatencyClass: 'fast' | 'medium' | 'slow' | 'unknown';
  components: {
    baseFit: number;
    verifiedSuccess: number;
    availability: number;
    organisationPreference: number;
    costPenalty: number;
    latencyPenalty: number;
    unknownTraitPenalty: number;
    independencePenalty: number;
    recentFailurePenalty: number;
  };
  rationale: string[];
  evidenceSourceIds: string[];
  knownGaps: string[];
}

export function scoreRoleCandidates(input: {
  candidates: readonly RoleScoringCandidate[];
  requirement: RoleRequirementProfile;
  config?: RoleScoringConfig;
}): RoleCandidateScore[] {
  const config = input.config ?? DEFAULT_ROLE_SCORING_CONFIG;
  const scores = input.candidates
    .filter(
      (candidate) =>
        candidate.hardConstraintDecision.eligible &&
        (candidate.independenceDecision?.eligible ?? true),
    )
    .map((candidate) => scoreCandidate(candidate, input.requirement, config));
  scores.sort(compareScores);
  return scores.map((score, index) => ({ ...score, rank: index + 1 }));
}

function scoreCandidate(
  candidate: RoleScoringCandidate,
  requirement: RoleRequirementProfile,
  config: RoleScoringConfig,
): Omit<RoleCandidateScore, 'rank'> {
  assertUnit(candidate.availabilityConfidence, 'availabilityConfidence');
  const weightedTraits = Object.entries(requirement.weights) as Array<[ModelTrait, number]>;
  const totalWeight = weightedTraits.reduce((sum, [, weight]) => sum + weight, 0);
  const traitContributions = weightedTraits.map(([trait, weight]) => ({
    trait,
    weight,
    score: effectiveTraitScore(candidate.profile.traits[trait]),
  }));
  const baseFit =
    totalWeight === 0
      ? 0
      : traitContributions.reduce(
          (sum, contribution) => sum + (contribution.score ?? 0) * contribution.weight,
          0,
        ) / totalWeight;
  const unknownTraits = traitContributions
    .filter((contribution) => contribution.score === undefined)
    .map((contribution) => contribution.trait);
  const unknownTraitPenalty = unknownTraits.length * config.unknownOptionalTraitPenalty;
  const observed = candidate.observedVerifiedSuccess;
  const observedEvidenceApplied =
    observed !== undefined &&
    observed.sampleSize >= config.minimumObservedSamples &&
    observed.confidence >= config.minimumObservedConfidence;
  const verifiedSuccess = observedEvidenceApplied
    ? observed!.score * observed!.confidence
    : 0;
  if (candidate.observedVerifiedSuccess) {
    assertUnit(candidate.observedVerifiedSuccess.score, 'observedVerifiedSuccess.score');
    assertUnit(candidate.observedVerifiedSuccess.confidence, 'observedVerifiedSuccess.confidence');
    if (candidate.observedVerifiedSuccess.sampleSize < 1) {
      throw new Error('Observed verified success requires a positive sample size');
    }
  }
  const organisationPreference = candidate.organisationPreference ?? 0;
  if (organisationPreference < -1 || organisationPreference > 1) {
    throw new Error('organisationPreference must be between -1 and 1');
  }
  const commercial = candidate.profile.constraints.find(
    (constraint) => constraint.kind === 'commercial',
  );
  const expectedCostClass = commercial?.costClass ?? 'unknown';
  const expectedLatencyClass = commercial?.latencyClass ?? 'unknown';
  const independencePenalty =
    (candidate.independenceDecision?.preferredViolations.length ?? 0) *
    config.preferredIndependencePenalty;
  const recentFailurePenalty = candidate.recentFailurePenalty ?? 0;
  if (
    !Number.isFinite(recentFailurePenalty) ||
    recentFailurePenalty < 0 ||
    recentFailurePenalty > 1
  ) {
    throw new Error('recentFailurePenalty must be between 0 and 1');
  }
  const components = {
    baseFit,
    verifiedSuccess,
    availability: candidate.availabilityConfidence,
    organisationPreference,
    costPenalty: config.costPenalty[expectedCostClass],
    latencyPenalty: config.latencyPenalty[expectedLatencyClass],
    unknownTraitPenalty,
    independencePenalty,
    recentFailurePenalty,
  };
  const score = clamp(
    baseFit +
      verifiedSuccess * 0.15 +
      candidate.availabilityConfidence * 0.08 +
      organisationPreference * 0.05 -
      components.costPenalty -
      components.latencyPenalty -
      unknownTraitPenalty -
      independencePenalty -
      recentFailurePenalty,
  );
  const constraintConfidence = constraintConfidenceFor(candidate, requirement);
  const traitConfidence =
    traitContributions.length === 0
      ? 0
      : traitContributions.reduce(
          (sum, contribution) =>
            sum + (candidate.profile.traits[contribution.trait]?.confidence ?? 0),
          0,
        ) / traitContributions.length;
  const confidence = clamp(
    constraintConfidence * 0.45 + traitConfidence * 0.35 + candidate.availabilityConfidence * 0.2,
  );
  const evidenceSourceIds = [
    ...new Set([
      ...Object.values(candidate.profile.capabilitySources),
      ...weightedTraits.flatMap(([trait]) => {
        const source = candidate.profile.traits[trait]?.evidenceSourceId;
        return source ? [source] : [];
      }),
    ]),
  ].sort();
  const knownGaps = [
    ...candidate.hardConstraintDecision.unknownRequiredCapabilities.map(
      (capability) => `unknown capability: ${capability}`,
    ),
    ...candidate.hardConstraintDecision.unknownRequiredTraits.map(
      (trait) => `unknown required trait: ${trait}`,
    ),
    ...unknownTraits.map((trait) => `unknown weighted trait: ${trait}`),
    ...(candidate.independenceDecision?.preferredViolations.map(
      (finding) => `preferred independence: ${finding.reason}`,
    ) ?? []),
    ...(!observedEvidenceApplied && candidate.observedVerifiedSuccess
      ? [
          `observed outcomes below threshold: ${candidate.observedVerifiedSuccess.sampleSize} samples at ${round(candidate.observedVerifiedSuccess.confidence)} confidence`,
        ]
      : []),
  ].sort();
  const rationale = [
    `Role fit ${round(baseFit)} from ${weightedTraits.length} weighted trait(s).`,
    `Constraint confidence ${round(constraintConfidence)}; availability confidence ${round(candidate.availabilityConfidence)}.`,
    `Expected cost ${expectedCostClass}; latency ${expectedLatencyClass}.`,
    ...(verifiedSuccess > 0
      ? [
          `Verified local outcome adjustment ${round(verifiedSuccess)} from ${candidate.observedVerifiedSuccess!.sampleSize} sample(s).`,
        ]
      : []),
    ...(knownGaps.length > 0 ? [`Known gaps: ${knownGaps.join('; ')}.`] : []),
  ];

  return {
    providerId: candidate.profile.providerId,
    modelId: candidate.profile.modelId,
    modelFamily: candidate.profile.modelFamily,
    role: requirement.role,
    scoringVersion: config.scoringVersion,
    profileVersion: candidate.profile.profileVersion,
    eligible: true,
    score: round(score),
    confidence: round(confidence),
    constraintConfidence: round(constraintConfidence),
    observedSuccessConfidence: round(
      observedEvidenceApplied ? candidate.observedVerifiedSuccess!.confidence : 0,
    ),
    expectedCostClass,
    expectedLatencyClass,
    components: mapNumbers(components),
    rationale,
    evidenceSourceIds,
    knownGaps,
  };
}

function constraintConfidenceFor(
  candidate: RoleScoringCandidate,
  requirement: RoleRequirementProfile,
): number {
  const total =
    requirement.requiredCapabilities.length + Object.keys(requirement.minimumTraits).length;
  if (total === 0) return 1;
  const unknown =
    candidate.hardConstraintDecision.unknownRequiredCapabilities.length +
    candidate.hardConstraintDecision.unknownRequiredTraits.length;
  return clamp(1 - unknown / total);
}

function compareScores(
  left: Omit<RoleCandidateScore, 'rank'>,
  right: Omit<RoleCandidateScore, 'rank'>,
) {
  return (
    right.score - left.score ||
    right.constraintConfidence - left.constraintConfidence ||
    right.observedSuccessConfidence - left.observedSuccessConfidence ||
    costRank(left.expectedCostClass) - costRank(right.expectedCostClass) ||
    latencyRank(left.expectedLatencyClass) - latencyRank(right.expectedLatencyClass) ||
    `${left.providerId}/${left.modelId}`.localeCompare(`${right.providerId}/${right.modelId}`)
  );
}

function costRank(value: RoleCandidateScore['expectedCostClass']): number {
  return ['free', 'low', 'medium', 'high', 'unknown'].indexOf(value);
}

function latencyRank(value: RoleCandidateScore['expectedLatencyClass']): number {
  return ['fast', 'medium', 'slow', 'unknown'].indexOf(value);
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function mapNumbers<T extends Record<string, number>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).map(([key, number]) => [key, round(number)]),
  ) as T;
}

function assertUnit(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${field} must be between 0 and 1`);
  }
}
