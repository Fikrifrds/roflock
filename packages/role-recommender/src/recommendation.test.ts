import { describe, expect, it } from 'vitest';
import { DEFAULT_CURATED_PROFILE_BUNDLE, loadCuratedProfileBundle } from './curated-bundle.js';
import { generateRoleRecommendation } from './recommendation.js';

const at = '2026-07-28T12:00:00.000Z';

describe('role recommendation generation', () => {
  it('selects a complete, deterministic and independently valid roster', () => {
    const bundle = loadCuratedProfileBundle(DEFAULT_CURATED_PROFILE_BUNDLE);
    const input = {
      id: 'recommendation_1',
      taskId: 'task_1',
      risk: 'high' as const,
      profileBundleVersion: bundle.bundleVersion,
      profileBundleDigest: bundle.digest,
      candidates: bundle.profiles.map((profile) => ({
        profile,
        health: 'ready' as const,
        authenticated: true,
        disabled: false,
        enforceablePermissionModes: [
          'read_only' as const,
          'planned_write' as const,
          'restricted_network' as const,
        ],
        availabilityConfidence: 0.9,
        runnerId: `${profile.providerId}-runner`,
      })),
      policy: { now: at },
      generatedAt: at,
    };
    const first = generateRoleRecommendation(input);
    const second = generateRoleRecommendation({ ...input, id: 'recommendation_2' });

    expect(first.complete).toBe(true);
    expect(first.independence.every((finding) => finding.satisfied)).toBe(true);
    expect(
      first.candidates.find((candidate) => candidate.role === 'executor' && candidate.selected),
    ).toMatchObject({ providerId: 'codex', eligible: true });
    expect(
      first.candidates
        .filter((candidate) => candidate.selected)
        .map(({ role, providerId, modelId }) => ({ role, providerId, modelId })),
    ).toEqual(
      second.candidates
        .filter((candidate) => candidate.selected)
        .map(({ role, providerId, modelId }) => ({ role, providerId, modelId })),
    );
    expect(first.inputHash).toBe(second.inputHash);
  });

  it('does not present an unavailable model as selected or fallback', () => {
    const bundle = loadCuratedProfileBundle(DEFAULT_CURATED_PROFILE_BUNDLE);
    const recommendation = generateRoleRecommendation({
      id: 'recommendation_unavailable',
      taskId: 'task_2',
      risk: 'medium',
      profileBundleVersion: bundle.bundleVersion,
      profileBundleDigest: bundle.digest,
      candidates: bundle.profiles.map((profile) => ({
        profile,
        health: profile.providerId === 'codex' ? ('missing' as const) : ('ready' as const),
        authenticated: profile.providerId !== 'codex',
        disabled: false,
        enforceablePermissionModes: ['read_only' as const, 'planned_write' as const],
        availabilityConfidence: 0.8,
        runnerId: `${profile.providerId}-runner`,
      })),
      policy: { now: at },
      generatedAt: at,
    });

    expect(recommendation.complete).toBe(false);
    expect(
      recommendation.candidates.some(
        (candidate) =>
          candidate.providerId === 'codex' && (candidate.selected || candidate.fallback),
      ),
    ).toBe(false);
    expect(recommendation.gaps).toContain('No eligible independent candidate for executor.');
  });
});
