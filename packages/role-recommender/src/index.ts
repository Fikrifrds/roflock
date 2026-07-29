import { EFFORT_LEVELS } from '@roleflock/provider-core';
import { z } from 'zod';

const IdentifierSchema = z.string().trim().min(1).max(240);
const TimestampSchema = z.string().datetime({ offset: true });
const SemverSchema = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
const UnitScoreSchema = z.number().min(0).max(1);

export const MODEL_TRAITS = [
  'planning_depth',
  'instruction_adherence',
  'repository_navigation',
  'patch_precision',
  'tool_reliability',
  'implementation_strength',
  'test_reasoning',
  'critical_review',
  'security_reasoning',
  'long_context',
  'speed',
  'cost_efficiency',
] as const;
export const ModelTraitSchema = z.enum(MODEL_TRAITS);
export type ModelTrait = z.infer<typeof ModelTraitSchema>;

export const PROFILE_SOURCE_KINDS = [
  'runtime_detected',
  'observed_verified',
  'curated',
  'user_asserted',
  'provider_reported',
] as const;
export const ProfileSourceKindSchema = z.enum(PROFILE_SOURCE_KINDS);
export type ProfileSourceKind = z.infer<typeof ProfileSourceKindSchema>;

export const CapabilityEvidenceSourceSchema = z
  .object({
    id: IdentifierSchema,
    kind: ProfileSourceKindSchema,
    locator: z.string().trim().min(1),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    capturedAt: TimestampSchema,
    description: z.string().trim().min(1),
  })
  .strict();
export type CapabilityEvidenceSource = z.infer<typeof CapabilityEvidenceSourceSchema>;

export const ScoredTraitSchema = z
  .object({
    score: UnitScoreSchema,
    confidence: UnitScoreSchema,
    source: z.enum(['provider_reported', 'curated', 'observed_verified', 'user_asserted']),
    evidenceSourceId: IdentifierSchema,
    sampleSize: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine((trait, context) => {
    if (trait.source === 'observed_verified' && trait.sampleSize === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sampleSize'],
        message: 'Observed traits require a positive sample size',
      });
    }
    if (trait.source !== 'observed_verified' && trait.sampleSize !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sampleSize'],
        message: 'Only observed traits may claim a sample size',
      });
    }
  });
export type ScoredTrait = z.infer<typeof ScoredTraitSchema>;

export const MODEL_CAPABILITIES = [
  'writes',
  'patches',
  'tools',
  'headless',
  'structuredOutput',
  'imageInput',
  'browser',
] as const;
export type BooleanModelCapability = (typeof MODEL_CAPABILITIES)[number];

export const ProfileConstraintSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('data_residency'),
      allowedRegions: z.array(IdentifierSchema).min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('privacy'),
      dataUse: z.enum(['local_only', 'no_training', 'provider_standard']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('permission'),
      unsupportedModes: z.array(z.enum(['read_only', 'planned_write', 'restricted_network'])),
    })
    .strict(),
  z
    .object({
      kind: z.literal('commercial'),
      costClass: z.enum(['free', 'low', 'medium', 'high', 'unknown']),
      latencyClass: z.enum(['fast', 'medium', 'slow', 'unknown']),
    })
    .strict(),
]);

export const ModelCapabilityProfileSchema = z
  .object({
    providerId: IdentifierSchema,
    modelId: IdentifierSchema,
    modelFamily: IdentifierSchema.optional(),
    profileVersion: SemverSchema,
    effectiveAt: TimestampSchema,
    capabilities: z
      .object({
        writes: z.boolean().optional(),
        patches: z.boolean().optional(),
        tools: z.boolean().optional(),
        headless: z.boolean().optional(),
        structuredOutput: z.boolean().optional(),
        imageInput: z.boolean().optional(),
        browser: z.boolean().optional(),
        maxContextTokens: z.number().int().positive().optional(),
        supportedEffort: z.array(z.enum(EFFORT_LEVELS as [string, ...string[]])).optional(),
      })
      .strict(),
    capabilitySources: z.record(IdentifierSchema, IdentifierSchema),
    traits: z.record(ModelTraitSchema, ScoredTraitSchema),
    constraints: z.array(ProfileConstraintSchema),
    evidenceSources: z.array(CapabilityEvidenceSourceSchema).min(1),
  })
  .strict()
  .superRefine((profile, context) => {
    const sources = new Map(profile.evidenceSources.map((source) => [source.id, source]));
    const duplicates = profile.evidenceSources
      .map((source) => source.id)
      .filter((id, index, ids) => ids.indexOf(id) !== index);
    if (duplicates.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidenceSources'],
        message: `Duplicate evidence source: ${duplicates[0]}`,
      });
    }
    for (const [capability, sourceId] of Object.entries(profile.capabilitySources)) {
      if (!sources.has(sourceId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['capabilitySources', capability],
          message: `Unknown capability evidence source: ${sourceId}`,
        });
      }
      if (!(capability in profile.capabilities)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['capabilitySources', capability],
          message: `Capability source has no capability value: ${capability}`,
        });
      }
    }
    for (const capability of Object.keys(profile.capabilities)) {
      if (!profile.capabilitySources[capability]) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['capabilities', capability],
          message: `Capability value has no evidence source: ${capability}`,
        });
      }
    }
    for (const [traitName, trait] of Object.entries(profile.traits)) {
      const source = sources.get(trait.evidenceSourceId);
      if (!source || source.kind !== trait.source) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['traits', traitName, 'evidenceSourceId'],
          message: 'Trait source kind does not match its evidence source',
        });
      }
    }
  });
export type ModelCapabilityProfile = z.infer<typeof ModelCapabilityProfileSchema>;

export interface CapabilityObservation<T> {
  value: T;
  source: ProfileSourceKind;
  evidenceSourceId: string;
}

const SOURCE_PRECEDENCE: Record<ProfileSourceKind, number> = {
  runtime_detected: 5,
  observed_verified: 4,
  curated: 3,
  user_asserted: 2,
  provider_reported: 1,
};

export function resolveCapabilityObservation<T>(
  observations: readonly CapabilityObservation<T>[],
): CapabilityObservation<T> | undefined {
  return [...observations].sort(
    (left, right) =>
      SOURCE_PRECEDENCE[right.source] - SOURCE_PRECEDENCE[left.source] ||
      left.evidenceSourceId.localeCompare(right.evidenceSourceId),
  )[0];
}

export function capabilityValue(
  profile: ModelCapabilityProfile,
  capability: BooleanModelCapability,
): boolean | undefined {
  return profile.capabilities[capability];
}

export function effectiveTraitScore(trait: ScoredTrait | undefined): number | undefined {
  return trait === undefined ? undefined : trait.score * trait.confidence;
}

export * from './hard-constraints.js';
export * from './independence.js';
export * from './scorer.js';
