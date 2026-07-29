import { describe, expect, it } from 'vitest';
import {
  ModelCapabilityProfileSchema,
  scoreRoleCandidates,
  type HardConstraintDecision,
  type RoleRequirementProfile,
  type RoleScoringCandidate,
} from './index.js';

describe('deterministic role scorer and rationale', () => {
  it('returns byte-identical rankings for identical versioned inputs', () => {
    const input = {
      requirement: plannerRequirement(),
      candidates: [
        candidate('provider-b', 'model-b', 0.8, 0.9),
        candidate('provider-a', 'model-a', 0.9, 0.8),
      ],
    };
    const first = scoreRoleCandidates(input);
    const second = scoreRoleCandidates(structuredClone(input));
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first[0]?.scoringVersion).toBe('rolefit-1.0.0');
    expect(first[0]?.rationale.length).toBeGreaterThan(2);
    expect(first[0]?.evidenceSourceIds).toEqual(['curated', 'runtime']);
  });

  it('never scores an ineligible candidate and records every adjustment', () => {
    const eligible = candidate('provider-a', 'eligible', 0.8, 0.8);
    const ineligible = candidate('provider-z', 'ineligible', 1, 1);
    ineligible.hardConstraintDecision.eligible = false;
    ineligible.hardConstraintDecision.violations = [
      {
        code: 'CAPABILITY_MISSING',
        field: 'capabilities.structuredOutput',
        reason: 'missing',
      },
    ];

    const [score] = scoreRoleCandidates({
      requirement: plannerRequirement(),
      candidates: [ineligible, eligible],
    });
    expect(score?.modelId).toBe('eligible');
    expect(score?.components).toMatchObject({
      baseFit: expect.any(Number),
      availability: 0.8,
      costPenalty: 0.03,
      latencyPenalty: 0,
      unknownTraitPenalty: 0,
      independencePenalty: 0,
    });
  });

  it('uses stable IDs as the final tie-break and exposes unknown weighted traits as gaps', () => {
    const left = candidate('provider-b', 'same', 0.8, 0.8);
    const right = candidate('provider-a', 'same', 0.8, 0.8);
    delete left.profile.traits.long_context;
    delete right.profile.traits.long_context;
    const ranking = scoreRoleCandidates({
      requirement: plannerRequirement(),
      candidates: [left, right],
    });
    expect(ranking.map((item) => item.providerId)).toEqual(['provider-a', 'provider-b']);
    expect(ranking[0]?.knownGaps).toContain('unknown weighted trait: long_context');
  });
});

function plannerRequirement(): RoleRequirementProfile {
  return {
    role: 'planner',
    requiredCapabilities: [
      { kind: 'boolean', capability: 'headless', value: true },
      { kind: 'boolean', capability: 'structuredOutput', value: true },
    ],
    minimumTraits: { instruction_adherence: 0.4 },
    weights: {
      planning_depth: 0.4,
      instruction_adherence: 0.35,
      long_context: 0.25,
    },
    maximumUnknownRequiredTraits: 0,
    permissionProfile: {
      repository: 'read',
      commands: 'readonly',
      network: 'none',
      credentials: 'none',
    },
  };
}

function candidate(
  providerId: string,
  modelId: string,
  planningScore: number,
  adherenceScore: number,
): RoleScoringCandidate {
  const profile = ModelCapabilityProfileSchema.parse({
    providerId,
    modelId,
    modelFamily: modelId,
    profileVersion: '1.0.0',
    effectiveAt: '2026-07-28T10:00:00.000Z',
    capabilities: { headless: true, structuredOutput: true },
    capabilitySources: { headless: 'runtime', structuredOutput: 'runtime' },
    traits: {
      planning_depth: trait(planningScore),
      instruction_adherence: trait(adherenceScore),
      long_context: trait(0.8),
    },
    constraints: [{ kind: 'commercial', costClass: 'medium', latencyClass: 'fast' }],
    evidenceSources: [
      {
        id: 'runtime',
        kind: 'runtime_detected',
        locator: `probe://${providerId}`,
        digest: 'a'.repeat(64),
        capturedAt: '2026-07-28T10:00:00.000Z',
        description: 'Runtime capabilities.',
      },
      {
        id: 'curated',
        kind: 'curated',
        locator: `bundle://${modelId}`,
        digest: 'b'.repeat(64),
        capturedAt: '2026-07-28T10:00:00.000Z',
        description: 'Curated traits.',
      },
    ],
  });
  return {
    profile,
    hardConstraintDecision: hardDecision(profile.providerId, profile.modelId),
    availabilityConfidence: 0.8,
  };
}

function trait(score: number) {
  return {
    score,
    confidence: 0.8,
    source: 'curated',
    evidenceSourceId: 'curated',
  } as const;
}

function hardDecision(providerId: string, modelId: string): HardConstraintDecision {
  return {
    providerId,
    modelId,
    role: 'planner',
    eligible: true,
    violations: [],
    unknownRequiredCapabilities: [],
    unknownRequiredTraits: [],
  };
}
