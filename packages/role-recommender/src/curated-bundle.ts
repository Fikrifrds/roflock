import { sha256Canonical } from '@roleflock/contracts';
import { z } from 'zod';
import {
  ModelCapabilityProfileSchema,
  type ModelCapabilityProfile,
  type ModelTrait,
  type ScoredTrait,
} from './index.js';
import { ROLE_SCORING_VERSION } from './scorer.js';

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const SemverSchema = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);

const CuratedBundleFields = {
  bundleVersion: SemverSchema,
  publishedAt: z.string().datetime({ offset: true }),
  scoringVersions: z.array(z.string().trim().min(1)).min(1),
  profiles: z.array(ModelCapabilityProfileSchema).min(1),
} as const;

function validateBundle(
  bundle: z.infer<z.ZodObject<typeof CuratedBundleFields>>,
  context: z.RefinementCtx,
): void {
  const identities = bundle.profiles.map((profile) => `${profile.providerId}/${profile.modelId}`);
  const duplicate = identities.find((identity, index) => identities.indexOf(identity) !== index);
  if (duplicate) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['profiles'],
      message: `Duplicate curated profile: ${duplicate}`,
    });
  }
  for (const [index, profile] of bundle.profiles.entries()) {
    if (profile.profileVersion !== bundle.bundleVersion) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['profiles', index, 'profileVersion'],
        message: 'Curated profile version must match its bundle version',
      });
    }
    if (Date.parse(profile.effectiveAt) > Date.parse(bundle.publishedAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['profiles', index, 'effectiveAt'],
        message: 'Profile cannot become effective after bundle publication',
      });
    }
  }
}

export const UnsealedCuratedProfileBundleSchema = z
  .object(CuratedBundleFields)
  .strict()
  .superRefine(validateBundle);
export type UnsealedCuratedProfileBundle = z.infer<typeof UnsealedCuratedProfileBundleSchema>;

export const CuratedProfileBundleSchema = z
  .object({
    ...CuratedBundleFields,
    hashAlgorithm: z.literal('sha256'),
    digest: DigestSchema,
  })
  .strict()
  .superRefine(validateBundle);
export type CuratedProfileBundle = z.infer<typeof CuratedProfileBundleSchema>;

export function sealCuratedProfileBundle(
  input: UnsealedCuratedProfileBundle,
): CuratedProfileBundle {
  const bundle = UnsealedCuratedProfileBundleSchema.parse(input);
  return CuratedProfileBundleSchema.parse({
    ...bundle,
    hashAlgorithm: 'sha256',
    digest: sha256Canonical(bundle),
  });
}

export function verifyCuratedProfileBundle(bundle: CuratedProfileBundle): boolean {
  const parsed = CuratedProfileBundleSchema.parse(bundle);
  const { digest, hashAlgorithm: _hashAlgorithm, ...unsealed } = parsed;
  return digest === sha256Canonical(UnsealedCuratedProfileBundleSchema.parse(unsealed));
}

export function loadCuratedProfileBundle(
  bundle: CuratedProfileBundle,
  scoringVersion = ROLE_SCORING_VERSION,
): Readonly<CuratedProfileBundle> {
  const parsed = CuratedProfileBundleSchema.parse(bundle);
  if (!verifyCuratedProfileBundle(parsed))
    throw new Error('Curated profile bundle digest is invalid');
  if (!parsed.scoringVersions.includes(scoringVersion)) {
    throw new Error(`Curated profile bundle is incompatible with ${scoringVersion}`);
  }
  return deepFreeze(structuredClone(parsed));
}

const bundleVersion = '2026.7.1';
const publishedAt = '2026-07-28T10:00:00.000Z';

export const DEFAULT_CURATED_PROFILE_BUNDLE = sealCuratedProfileBundle({
  bundleVersion,
  publishedAt,
  scoringVersions: [ROLE_SCORING_VERSION],
  profiles: [
    profile(
      'codex',
      'gpt-5.6-sol',
      'gpt-5.6-sol',
      {
        planning_depth: 0.93,
        instruction_adherence: 0.9,
        repository_navigation: 0.91,
        patch_precision: 0.9,
        tool_reliability: 0.9,
        implementation_strength: 0.93,
        test_reasoning: 0.9,
        critical_review: 0.86,
        security_reasoning: 0.85,
        long_context: 0.9,
        speed: 0.55,
        cost_efficiency: 0.4,
      },
      'high',
      'slow',
    ),
    profile(
      'codex',
      'gpt-5.6-terra',
      'gpt-5.6-terra',
      {
        planning_depth: 0.85,
        instruction_adherence: 0.88,
        repository_navigation: 0.87,
        patch_precision: 0.88,
        tool_reliability: 0.88,
        implementation_strength: 0.88,
        test_reasoning: 0.85,
        critical_review: 0.82,
        security_reasoning: 0.8,
        long_context: 0.82,
        speed: 0.8,
        cost_efficiency: 0.72,
      },
      'medium',
      'medium',
    ),
    profile(
      'codex',
      'gpt-5.6-luna',
      'gpt-5.6-luna',
      {
        planning_depth: 0.7,
        instruction_adherence: 0.8,
        repository_navigation: 0.75,
        patch_precision: 0.78,
        tool_reliability: 0.78,
        implementation_strength: 0.75,
        test_reasoning: 0.72,
        critical_review: 0.68,
        security_reasoning: 0.65,
        long_context: 0.68,
        speed: 0.94,
        cost_efficiency: 0.9,
      },
      'low',
      'fast',
    ),
    profile(
      'claude',
      'opus',
      'opus',
      {
        planning_depth: 0.94,
        instruction_adherence: 0.9,
        repository_navigation: 0.88,
        patch_precision: 0.82,
        tool_reliability: 0.75,
        implementation_strength: 0.88,
        test_reasoning: 0.9,
        critical_review: 0.93,
        security_reasoning: 0.88,
        long_context: 0.92,
        speed: 0.5,
        cost_efficiency: 0.38,
      },
      'high',
      'slow',
      false,
    ),
    profile(
      'claude',
      'sonnet',
      'sonnet',
      {
        planning_depth: 0.84,
        instruction_adherence: 0.87,
        repository_navigation: 0.83,
        patch_precision: 0.82,
        tool_reliability: 0.74,
        implementation_strength: 0.82,
        test_reasoning: 0.83,
        critical_review: 0.84,
        security_reasoning: 0.8,
        long_context: 0.83,
        speed: 0.8,
        cost_efficiency: 0.72,
      },
      'medium',
      'medium',
      false,
    ),
    profile(
      'claude',
      'haiku',
      'haiku',
      {
        planning_depth: 0.62,
        instruction_adherence: 0.76,
        repository_navigation: 0.68,
        patch_precision: 0.7,
        tool_reliability: 0.68,
        implementation_strength: 0.66,
        test_reasoning: 0.65,
        critical_review: 0.64,
        security_reasoning: 0.58,
        long_context: 0.65,
        speed: 0.95,
        cost_efficiency: 0.92,
      },
      'low',
      'fast',
      false,
    ),
  ],
});

function profile(
  providerId: string,
  modelId: string,
  modelFamily: string,
  traitScores: Record<ModelTrait, number>,
  costClass: 'low' | 'medium' | 'high',
  latencyClass: 'fast' | 'medium' | 'slow',
  writes = true,
): ModelCapabilityProfile {
  const evidenceSourceId = `curated-${providerId}-${modelId}`;
  const evidenceDigest = sha256Canonical({
    bundleVersion,
    providerId,
    modelId,
    statement: 'RoleFlock cold-start profile; not organisation-observed performance.',
  });
  const traits = Object.fromEntries(
    Object.entries(traitScores).map(([trait, score]) => [
      trait,
      {
        score,
        confidence: 0.58,
        source: 'curated',
        evidenceSourceId,
      } satisfies ScoredTrait,
    ]),
  ) as Record<ModelTrait, ScoredTrait>;
  const capabilities = {
    writes,
    patches: writes,
    tools: providerId === 'codex',
    headless: true,
    structuredOutput: true,
    supportedEffort: ['low', 'medium', 'high'],
  };
  return ModelCapabilityProfileSchema.parse({
    providerId,
    modelId,
    modelFamily,
    profileVersion: bundleVersion,
    effectiveAt: publishedAt,
    capabilities,
    capabilitySources: Object.fromEntries(
      Object.keys(capabilities).map((capability) => [capability, evidenceSourceId]),
    ),
    traits,
    constraints: [
      { kind: 'privacy', dataUse: 'provider_standard' },
      { kind: 'commercial', costClass, latencyClass },
    ],
    evidenceSources: [
      {
        id: evidenceSourceId,
        kind: 'curated',
        locator: `roleflock-profile://${bundleVersion}/${providerId}/${modelId}`,
        digest: evidenceDigest,
        capturedAt: publishedAt,
        description:
          'Versioned RoleFlock cold-start estimate; not organisation-observed performance.',
      },
    ],
  });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
