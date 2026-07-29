import { describe, expect, it } from 'vitest';
import { DEFAULT_CURATED_PROFILE_BUNDLE, loadCuratedProfileBundle } from './curated-bundle.js';
import {
  generateRoleRecommendation,
  validateRecommendationFallbackMatrix,
  validateRecommendationRoster,
} from './recommendation.js';

describe('role recommendation adversarial invariants', () => {
  it('keeps every simultaneous fallback combination inside critical independence policy', () => {
    const recommendation = criticalRecommendation();
    expect(recommendation.complete).toBe(true);
    const decisions = validateRecommendationFallbackMatrix(recommendation);
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.every((decision) => decision.eligible)).toBe(true);
    for (const fallback of recommendation.candidates.filter((candidate) => candidate.fallback)) {
      expect(fallback.eligible).toBe(true);
      expect(fallback.violations).toHaveLength(0);
    }
  });

  it('rejects an executor without write capability even when manually placed in the roster', () => {
    const recommendation = criticalRecommendation();
    const selected = recommendation.candidates
      .filter((candidate) => candidate.selected)
      .map((candidate) => ({
        role: candidate.role,
        providerId: candidate.providerId,
        modelId: candidate.modelId,
      }));
    const claudeExecutor = recommendation.candidates.find(
      (candidate) => candidate.role === 'executor' && candidate.providerId === 'claude',
    );
    expect(claudeExecutor?.eligible).toBe(false);
    const malicious = selected.map((choice) =>
      choice.role === 'executor'
        ? {
            role: choice.role,
            providerId: claudeExecutor!.providerId,
            modelId: claudeExecutor!.modelId,
          }
        : choice,
    );
    const decision = validateRecommendationRoster(recommendation, malicious);
    expect(decision.eligible).toBe(false);
    expect(decision.unknownOrIneligible).toContainEqual(
      malicious.find((x) => x.role === 'executor'),
    );
  });

  it('rejects a critical verifier correlated with the executor provider', () => {
    const recommendation = criticalRecommendation();
    const selected = recommendation.candidates
      .filter((candidate) => candidate.selected)
      .map((candidate) => ({
        role: candidate.role,
        providerId: candidate.providerId,
        modelId: candidate.modelId,
      }));
    const executor = selected.find((choice) => choice.role === 'executor')!;
    const correlatedVerifier = recommendation.candidates.find(
      (candidate) =>
        candidate.role === 'verifier' &&
        candidate.providerId === executor.providerId &&
        candidate.eligible,
    );
    // Candidate eligibility is roster-aware, so a correlated verifier must
    // never be exposed as a selectable override in the first place.
    expect(correlatedVerifier).toBeUndefined();
  });
});

function criticalRecommendation() {
  const bundle = loadCuratedProfileBundle(DEFAULT_CURATED_PROFILE_BUNDLE);
  return generateRoleRecommendation({
    id: 'critical_recommendation',
    taskId: 'critical_task',
    risk: 'critical',
    profileBundleVersion: bundle.bundleVersion,
    profileBundleDigest: bundle.digest,
    candidates: bundle.profiles.map((profile) => ({
      profile,
      health: 'ready',
      authenticated: true,
      disabled: false,
      enforceablePermissionModes: ['read_only', 'planned_write', 'restricted_network'],
      availabilityConfidence: 0.9,
      runnerIds: {
        planner: 'agent-runner',
        plan_critic: 'agent-runner',
        executor: 'writer-runner',
        verifier: 'clean-verifier-runner',
      },
    })),
    policy: { now: at },
    generatedAt: at,
  });
}

const at = '2026-07-28T12:00:00.000Z';
