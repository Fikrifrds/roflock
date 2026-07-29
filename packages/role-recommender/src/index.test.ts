import { describe, expect, it } from 'vitest';
import {
  ModelCapabilityProfileSchema,
  capabilityValue,
  effectiveTraitScore,
  resolveCapabilityObservation,
} from './index.js';

describe('Model Capability Profile source policy', () => {
  it('preserves unknown capability and trait values instead of inventing neutral scores', () => {
    const profile = ModelCapabilityProfileSchema.parse(profileFixture());
    expect(capabilityValue(profile, 'writes')).toBeUndefined();
    expect(profile.traits.patch_precision).toBeUndefined();
    expect(effectiveTraitScore(profile.traits.planning_depth)).toBeCloseTo(0.63);
    expect(effectiveTraitScore(profile.traits.patch_precision)).toBeUndefined();
  });

  it('uses deterministic source precedence with stable evidence tie-breaking', () => {
    expect(
      resolveCapabilityObservation([
        { value: false, source: 'provider_reported', evidenceSourceId: 'provider' },
        { value: true, source: 'runtime_detected', evidenceSourceId: 'probe-z' },
        { value: false, source: 'runtime_detected', evidenceSourceId: 'probe-a' },
        { value: false, source: 'curated', evidenceSourceId: 'bundle' },
      ]),
    ).toEqual({ value: false, source: 'runtime_detected', evidenceSourceId: 'probe-a' });
  });

  it('rejects unverifiable trait sources and observed scores without samples', () => {
    const fixture = profileFixture();
    expect(() =>
      ModelCapabilityProfileSchema.parse({
        ...fixture,
        traits: {
          planning_depth: {
            score: 0.9,
            confidence: 0.7,
            source: 'observed_verified',
            evidenceSourceId: 'curated-1',
          },
        },
      }),
    ).toThrow(/sample size|source kind/i);
    expect(() =>
      ModelCapabilityProfileSchema.parse({
        ...fixture,
        capabilitySources: { headless: 'missing-source' },
      }),
    ).toThrow(/Unknown capability evidence source/);
  });
});

function profileFixture() {
  return {
    providerId: 'provider-a',
    modelId: 'model-a',
    modelFamily: 'family-a',
    profileVersion: '1.0.0',
    effectiveAt: '2026-07-28T10:00:00.000Z',
    capabilities: {
      tools: true,
      headless: true,
      structuredOutput: true,
      maxContextTokens: 200_000,
      supportedEffort: ['low', 'medium', 'high'],
    },
    capabilitySources: {
      tools: 'runtime-1',
      headless: 'runtime-1',
      structuredOutput: 'curated-1',
      maxContextTokens: 'provider-1',
      supportedEffort: 'provider-1',
    },
    traits: {
      planning_depth: {
        score: 0.9,
        confidence: 0.7,
        source: 'curated',
        evidenceSourceId: 'curated-1',
      },
    },
    constraints: [],
    evidenceSources: [
      {
        id: 'runtime-1',
        kind: 'runtime_detected',
        locator: 'probe://provider-a',
        digest: 'a'.repeat(64),
        capturedAt: '2026-07-28T10:00:00.000Z',
        description: 'Local provider capability probe.',
      },
      {
        id: 'curated-1',
        kind: 'curated',
        locator: 'roleflock-profile://1.0.0/provider-a/model-a',
        digest: 'b'.repeat(64),
        capturedAt: '2026-07-28T10:00:00.000Z',
        description: 'Versioned RoleFlock profile.',
      },
      {
        id: 'provider-1',
        kind: 'provider_reported',
        locator: 'provider-catalogue://provider-a/model-a',
        digest: 'c'.repeat(64),
        capturedAt: '2026-07-28T10:00:00.000Z',
        description: 'Provider catalogue metadata.',
      },
    ],
  };
}
