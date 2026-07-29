import { describe, expect, it } from 'vitest';
import {
  ModelCapabilityProfileSchema,
  evaluateHardConstraints,
  type CandidateRuntimeState,
  type RoleRequirementProfile,
} from './index.js';

describe('role hard-constraint engine', () => {
  it('rejects a writer-incompatible model as executor regardless of trait quality', () => {
    const decision = evaluateHardConstraints({
      candidate: candidate({ writes: false }),
      requirement: executorRequirement(),
      policy: policy(),
    });
    expect(decision.eligible).toBe(false);
    expect(decision.violations).toContainEqual(
      expect.objectContaining({
        code: 'CAPABILITY_MISSING',
        field: 'capabilities.writes',
      }),
    );
  });

  it('fails closed for unknown required capability unless exploration is explicit', () => {
    const strict = evaluateHardConstraints({
      candidate: candidate({ writes: undefined }),
      requirement: executorRequirement(),
      policy: policy(),
    });
    expect(strict.eligible).toBe(false);
    expect(strict.unknownRequiredCapabilities).toEqual(['writes']);
    expect(strict.violations.some((item) => item.code === 'CAPABILITY_UNKNOWN')).toBe(true);

    const exploratory = evaluateHardConstraints({
      candidate: candidate({ writes: undefined }),
      requirement: executorRequirement(),
      policy: { ...policy(), exploratoryUnknownCapabilities: true },
    });
    expect(exploratory.eligible).toBe(true);
    expect(exploratory.unknownRequiredCapabilities).toEqual(['writes']);
  });

  it('enforces runtime, permission, privacy, context, effort, and cost constraints together', () => {
    const state = candidate({ writes: true });
    state.cooldownUntil = '2026-07-28T12:00:00.000Z';
    state.enforceablePermissionModes = ['read_only'];
    const decision = evaluateHardConstraints({
      candidate: state,
      requirement: executorRequirement(),
      policy: {
        ...policy(),
        requiredDataRegion: 'eu',
        privacy: 'local_only',
        maximumCostClass: 'low',
      },
    });
    expect(decision.eligible).toBe(false);
    expect(decision.violations.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'PROVIDER_COOLDOWN',
        'PERMISSION_UNENFORCEABLE',
        'DATA_RESIDENCY',
        'PRIVACY_POLICY',
        'COST_POLICY',
      ]),
    );
  });

  it('returns an eligible executor only when every hard constraint passes', () => {
    const decision = evaluateHardConstraints({
      candidate: candidate({ writes: true }),
      requirement: executorRequirement(),
      policy: policy(),
    });
    expect(decision).toMatchObject({
      eligible: true,
      providerId: 'provider-a',
      modelId: 'model-a',
      role: 'executor',
      violations: [],
    });
  });
});

function executorRequirement(): RoleRequirementProfile {
  return {
    role: 'executor',
    requiredCapabilities: [
      { kind: 'boolean', capability: 'writes', value: true },
      { kind: 'boolean', capability: 'tools', value: true },
      { kind: 'boolean', capability: 'headless', value: true },
      { kind: 'minimum_context', tokens: 100_000 },
    ],
    minimumTraits: { instruction_adherence: 0.4 },
    weights: { instruction_adherence: 1 },
    maximumUnknownRequiredTraits: 0,
    permissionProfile: {
      repository: 'planned_write',
      commands: 'approved',
      network: 'none',
      credentials: 'none',
    },
    requiredEffort: 'high',
  };
}

function candidate(input: { writes: boolean | undefined }): CandidateRuntimeState {
  const capabilities = {
    ...(input.writes === undefined ? {} : { writes: input.writes }),
    tools: true,
    headless: true,
    maxContextTokens: 200_000,
    supportedEffort: ['low', 'medium', 'high'],
  };
  return {
    profile: ModelCapabilityProfileSchema.parse({
      providerId: 'provider-a',
      modelId: 'model-a',
      modelFamily: 'family-a',
      profileVersion: '1.0.0',
      effectiveAt: '2026-07-28T10:00:00.000Z',
      capabilities,
      capabilitySources: Object.fromEntries(
        Object.keys(capabilities).map((capability) => [capability, 'runtime']),
      ),
      traits: {
        instruction_adherence: {
          score: 1,
          confidence: 1,
          source: 'curated',
          evidenceSourceId: 'curated',
        },
      },
      constraints: [
        { kind: 'privacy', dataUse: 'no_training' },
        { kind: 'data_residency', allowedRegions: ['us'] },
        { kind: 'commercial', costClass: 'medium', latencyClass: 'fast' },
      ],
      evidenceSources: [
        {
          id: 'runtime',
          kind: 'runtime_detected',
          locator: 'probe://provider-a',
          digest: 'a'.repeat(64),
          capturedAt: '2026-07-28T10:00:00.000Z',
          description: 'Runtime capability probe.',
        },
        {
          id: 'curated',
          kind: 'curated',
          locator: 'bundle://1.0.0',
          digest: 'b'.repeat(64),
          capturedAt: '2026-07-28T10:00:00.000Z',
          description: 'Curated trait bundle.',
        },
      ],
    }),
    health: 'ready',
    authenticated: true,
    disabled: false,
    enforceablePermissionModes: ['planned_write', 'restricted_network'],
  };
}

function policy() {
  return { now: '2026-07-28T10:00:00.000Z' };
}
