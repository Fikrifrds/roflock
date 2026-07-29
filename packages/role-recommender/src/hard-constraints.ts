import { EFFORT_LEVELS } from '@roleflock/provider-core';
import { ROLE_IDS } from '@roleflock/role-protocol';
import { z } from 'zod';
import {
  ModelCapabilityProfileSchema,
  type BooleanModelCapability,
  type ModelCapabilityProfile,
  type ModelTrait,
} from './index.js';

const COST_CLASSES = ['free', 'low', 'medium', 'high'] as const;
const BOOLEAN_CAPABILITIES = [
  'writes',
  'patches',
  'tools',
  'headless',
  'structuredOutput',
  'imageInput',
  'browser',
] as const;
const TRAITS = [
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

export const CapabilityPredicateSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('boolean'),
      capability: z.enum(BOOLEAN_CAPABILITIES),
      value: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('minimum_context'),
      tokens: z.number().int().positive(),
    })
    .strict(),
]);

export const PermissionProfileReferenceSchema = z
  .object({
    repository: z.enum(['none', 'read', 'planned_write']),
    commands: z.enum(['none', 'readonly', 'approved']),
    network: z.enum(['none', 'approved']),
    credentials: z.enum(['none', 'scoped']),
  })
  .strict();

export const RoleRequirementProfileSchema = z
  .object({
    role: z.enum(ROLE_IDS),
    requiredCapabilities: z.array(CapabilityPredicateSchema),
    minimumTraits: z.record(z.enum(TRAITS), z.number().min(0).max(1)),
    weights: z.record(z.enum(TRAITS), z.number().min(0)),
    maximumUnknownRequiredTraits: z.number().int().nonnegative(),
    permissionProfile: PermissionProfileReferenceSchema,
    requiredEffort: z.enum(EFFORT_LEVELS as [string, ...string[]]).optional(),
  })
  .strict();
export type RoleRequirementProfile = z.infer<typeof RoleRequirementProfileSchema>;

export interface CandidateRuntimeState {
  profile: ModelCapabilityProfile;
  health: 'ready' | 'missing' | 'unauthenticated' | 'error';
  authenticated: boolean;
  disabled: boolean;
  cooldownUntil?: string;
  enforceablePermissionModes: Array<'read_only' | 'planned_write' | 'restricted_network'>;
}

export interface HardConstraintPolicy {
  now: string;
  exploratoryUnknownCapabilities?: boolean;
  allowedProviderIds?: string[];
  forbiddenProviderIds?: string[];
  requiredDataRegion?: string;
  privacy?: 'local_only' | 'no_training' | 'provider_standard';
  maximumCostClass?: (typeof COST_CLASSES)[number];
}

export type HardConstraintViolationCode =
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_UNAUTHENTICATED'
  | 'PROVIDER_DISABLED'
  | 'PROVIDER_COOLDOWN'
  | 'PROVIDER_POLICY'
  | 'CAPABILITY_MISSING'
  | 'CAPABILITY_UNKNOWN'
  | 'TRAIT_BELOW_MINIMUM'
  | 'TOO_MANY_UNKNOWN_TRAITS'
  | 'PERMISSION_UNENFORCEABLE'
  | 'CONTEXT_INSUFFICIENT'
  | 'CONTEXT_UNKNOWN'
  | 'EFFORT_UNSUPPORTED'
  | 'EFFORT_UNKNOWN'
  | 'PRIVACY_POLICY'
  | 'DATA_RESIDENCY'
  | 'COST_POLICY'
  | 'COST_UNKNOWN';

export interface HardConstraintViolation {
  code: HardConstraintViolationCode;
  field: string;
  reason: string;
}

export interface HardConstraintDecision {
  providerId: string;
  modelId: string;
  role: RoleRequirementProfile['role'];
  eligible: boolean;
  violations: HardConstraintViolation[];
  unknownRequiredCapabilities: string[];
  unknownRequiredTraits: ModelTrait[];
}

export function evaluateHardConstraints(input: {
  candidate: CandidateRuntimeState;
  requirement: RoleRequirementProfile;
  policy: HardConstraintPolicy;
}): HardConstraintDecision {
  const candidate = {
    ...input.candidate,
    profile: ModelCapabilityProfileSchema.parse(input.candidate.profile),
  };
  const requirement = RoleRequirementProfileSchema.parse(input.requirement);
  const violations: HardConstraintViolation[] = [];
  const unknownRequiredCapabilities: string[] = [];

  if (candidate.health !== 'ready') {
    violation(
      violations,
      'PROVIDER_UNAVAILABLE',
      'health',
      `Provider health is ${candidate.health}`,
    );
  }
  if (!candidate.authenticated || candidate.health === 'unauthenticated') {
    violation(
      violations,
      'PROVIDER_UNAUTHENTICATED',
      'authenticated',
      'Provider is not authenticated',
    );
  }
  if (candidate.disabled) {
    violation(violations, 'PROVIDER_DISABLED', 'disabled', 'Provider or model is disabled');
  }
  if (
    candidate.cooldownUntil &&
    Date.parse(candidate.cooldownUntil) > Date.parse(input.policy.now)
  ) {
    violation(
      violations,
      'PROVIDER_COOLDOWN',
      'cooldownUntil',
      `Candidate is cooling down until ${candidate.cooldownUntil}`,
    );
  }
  if (
    (input.policy.allowedProviderIds &&
      !input.policy.allowedProviderIds.includes(candidate.profile.providerId)) ||
    input.policy.forbiddenProviderIds?.includes(candidate.profile.providerId)
  ) {
    violation(
      violations,
      'PROVIDER_POLICY',
      'providerId',
      'Provider is forbidden by task or organisation policy',
    );
  }

  for (const predicate of requirement.requiredCapabilities) {
    if (predicate.kind === 'minimum_context') {
      const actual = candidate.profile.capabilities.maxContextTokens;
      if (actual === undefined) {
        unknownRequiredCapabilities.push('maxContextTokens');
        if (!input.policy.exploratoryUnknownCapabilities) {
          violation(
            violations,
            'CONTEXT_UNKNOWN',
            'capabilities.maxContextTokens',
            'Required context capacity is unknown',
          );
        }
      } else if (actual < predicate.tokens) {
        violation(
          violations,
          'CONTEXT_INSUFFICIENT',
          'capabilities.maxContextTokens',
          `Context capacity ${actual} is below required ${predicate.tokens}`,
        );
      }
      continue;
    }
    evaluateBooleanCapability(
      candidate.profile,
      predicate.capability,
      predicate.value,
      input.policy,
      unknownRequiredCapabilities,
      violations,
    );
  }

  const unknownRequiredTraits = Object.keys(requirement.minimumTraits).filter(
    (trait): trait is ModelTrait => candidate.profile.traits[trait as ModelTrait] === undefined,
  );
  for (const [trait, minimum] of Object.entries(requirement.minimumTraits) as Array<
    [ModelTrait, number]
  >) {
    const actual = candidate.profile.traits[trait];
    if (actual && actual.score * actual.confidence < minimum) {
      violation(
        violations,
        'TRAIT_BELOW_MINIMUM',
        `traits.${trait}`,
        `Effective ${trait} score is below ${minimum}`,
      );
    }
  }
  if (unknownRequiredTraits.length > requirement.maximumUnknownRequiredTraits) {
    violation(
      violations,
      'TOO_MANY_UNKNOWN_TRAITS',
      'traits',
      `${unknownRequiredTraits.length} required traits are unknown; maximum is ${requirement.maximumUnknownRequiredTraits}`,
    );
  }

  const requiredPermissionModes = [
    ...(requirement.permissionProfile.repository === 'planned_write'
      ? ['planned_write' as const]
      : []),
    ...(requirement.permissionProfile.repository === 'read' ? ['read_only' as const] : []),
    ...(requirement.permissionProfile.network === 'none' ? ['restricted_network' as const] : []),
  ];
  for (const mode of requiredPermissionModes) {
    if (
      !candidate.enforceablePermissionModes.includes(mode) ||
      unsupportedPermissionModes(candidate.profile).includes(mode)
    ) {
      violation(
        violations,
        'PERMISSION_UNENFORCEABLE',
        'permissionProfile',
        `Required permission mode cannot be enforced: ${mode}`,
      );
    }
  }

  if (requirement.requiredEffort) {
    const supported = candidate.profile.capabilities.supportedEffort;
    if (!supported) {
      violation(
        violations,
        'EFFORT_UNKNOWN',
        'capabilities.supportedEffort',
        'Required effort support is unknown',
      );
    } else if (!supported.includes(requirement.requiredEffort)) {
      violation(
        violations,
        'EFFORT_UNSUPPORTED',
        'capabilities.supportedEffort',
        `Required effort is unsupported: ${requirement.requiredEffort}`,
      );
    }
  }
  evaluatePrivacy(candidate.profile, input.policy, violations);
  evaluateCost(candidate.profile, input.policy, violations);

  return {
    providerId: candidate.profile.providerId,
    modelId: candidate.profile.modelId,
    role: requirement.role,
    eligible: violations.length === 0,
    violations,
    unknownRequiredCapabilities: [...new Set(unknownRequiredCapabilities)].sort(),
    unknownRequiredTraits: unknownRequiredTraits.sort(),
  };
}

function evaluateBooleanCapability(
  profile: ModelCapabilityProfile,
  capability: BooleanModelCapability,
  expected: boolean,
  policy: HardConstraintPolicy,
  unknown: string[],
  violations: HardConstraintViolation[],
): void {
  const actual = profile.capabilities[capability];
  if (actual === undefined) {
    unknown.push(capability);
    if (!policy.exploratoryUnknownCapabilities) {
      violation(
        violations,
        'CAPABILITY_UNKNOWN',
        `capabilities.${capability}`,
        `Required capability is unknown: ${capability}`,
      );
    }
  } else if (actual !== expected) {
    violation(
      violations,
      'CAPABILITY_MISSING',
      `capabilities.${capability}`,
      `Required capability ${capability}=${expected}, received ${actual}`,
    );
  }
}

function unsupportedPermissionModes(profile: ModelCapabilityProfile) {
  return profile.constraints
    .filter(
      (
        constraint,
      ): constraint is Extract<
        ModelCapabilityProfile['constraints'][number],
        { kind: 'permission' }
      > => constraint.kind === 'permission',
    )
    .flatMap((constraint) => constraint.unsupportedModes);
}

function evaluatePrivacy(
  profile: ModelCapabilityProfile,
  policy: HardConstraintPolicy,
  violations: HardConstraintViolation[],
): void {
  if (policy.requiredDataRegion) {
    const residency = profile.constraints.find(
      (constraint) => constraint.kind === 'data_residency',
    );
    if (!residency || !residency.allowedRegions.includes(policy.requiredDataRegion)) {
      violation(
        violations,
        'DATA_RESIDENCY',
        'constraints.data_residency',
        `Required data region is unsupported or unknown: ${policy.requiredDataRegion}`,
      );
    }
  }
  if (policy.privacy) {
    const privacy = profile.constraints.find((constraint) => constraint.kind === 'privacy');
    const strength = { provider_standard: 0, no_training: 1, local_only: 2 } as const;
    if (!privacy || strength[privacy.dataUse] < strength[policy.privacy]) {
      violation(
        violations,
        'PRIVACY_POLICY',
        'constraints.privacy',
        `Required privacy policy is unsupported or unknown: ${policy.privacy}`,
      );
    }
  }
}

function evaluateCost(
  profile: ModelCapabilityProfile,
  policy: HardConstraintPolicy,
  violations: HardConstraintViolation[],
): void {
  if (!policy.maximumCostClass) return;
  const commercial = profile.constraints.find((constraint) => constraint.kind === 'commercial');
  if (!commercial || commercial.costClass === 'unknown') {
    violation(
      violations,
      'COST_UNKNOWN',
      'constraints.commercial.costClass',
      'Cost class is unknown under a strict task budget',
    );
    return;
  }
  if (COST_CLASSES.indexOf(commercial.costClass) > COST_CLASSES.indexOf(policy.maximumCostClass)) {
    violation(
      violations,
      'COST_POLICY',
      'constraints.commercial.costClass',
      `Cost class ${commercial.costClass} exceeds ${policy.maximumCostClass}`,
    );
  }
}

function violation(
  violations: HardConstraintViolation[],
  code: HardConstraintViolationCode,
  field: string,
  reason: string,
): void {
  violations.push({ code, field, reason });
}
