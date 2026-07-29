import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CURATED_PROFILE_BUNDLE,
  loadCuratedProfileBundle,
} from '@roleflock/role-recommender/curated-bundle';
import { generateRoleRecommendation } from '@roleflock/role-recommender';
import { migrate, openDatabase, type SqliteDb } from './client.js';
import {
  RecommendationIdempotencyConflictError,
  RecommendationVersionConflictError,
  RoleRecommendationRepository,
} from './repositories/role-recommendation-repository.js';

let db: SqliteDb | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
});

describe('RoleRecommendationRepository', () => {
  it('persists immutable recommendations and audits idempotent roster actions', () => {
    db = openDatabase({ path: ':memory:' });
    migrate(db);
    const repository = new RoleRecommendationRepository(db);
    const bundle = loadCuratedProfileBundle(DEFAULT_CURATED_PROFILE_BUNDLE);
    repository.recordProfiles(bundle.profiles, bundle.bundleVersion, at);
    const recommendation = generateRoleRecommendation({
      id: 'recommendation_1',
      taskId: 'task_1',
      risk: 'medium',
      profileBundleVersion: bundle.bundleVersion,
      profileBundleDigest: bundle.digest,
      candidates: bundle.profiles.map((profile) => ({
        profile,
        health: 'ready',
        authenticated: true,
        disabled: false,
        enforceablePermissionModes: ['read_only', 'planned_write', 'restricted_network'],
        availabilityConfidence: 0.9,
        runnerId: `${profile.providerId}-runner`,
      })),
      policy: { now: at },
      generatedAt: at,
    });
    repository.create(recommendation);
    const roster = recommendation.candidates
      .filter((candidate) => candidate.selected)
      .map((candidate) => ({
        role: candidate.role,
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        effort: candidate.effort,
      }));
    const action = repository.recordAction({
      recommendationId: recommendation.id,
      expectedRevision: 0,
      action: 'applied',
      actor: 'local-user',
      roster,
      idempotencyKey: 'apply-1',
      createdAt: at,
    });
    expect(action.revision).toBe(1);
    expect(
      repository.recordAction({
        recommendationId: recommendation.id,
        expectedRevision: 0,
        action: 'applied',
        actor: 'local-user',
        roster,
        idempotencyKey: 'apply-1',
        createdAt: at,
      }),
    ).toEqual(action);
    expect(repository.getLatestByTask('task_1')).toMatchObject({
      recommendation: { id: 'recommendation_1', profileBundleVersion: bundle.bundleVersion },
      revision: 1,
    });
    expect(() =>
      repository.recordAction({
        recommendationId: recommendation.id,
        expectedRevision: 0,
        action: 'applied',
        actor: 'local-user',
        roster,
        idempotencyKey: 'apply-2',
        createdAt: at,
      }),
    ).toThrow(RecommendationVersionConflictError);
    expect(() =>
      repository.recordAction({
        recommendationId: recommendation.id,
        expectedRevision: 1,
        action: 'overridden',
        actor: 'local-user',
        role: 'planner',
        providerId: 'claude',
        modelId: 'sonnet',
        reason: 'Prefer lower cost for this task.',
        roster,
        idempotencyKey: 'apply-1',
        createdAt: at,
      }),
    ).toThrow(RecommendationIdempotencyConflictError);
    expect(() =>
      db!
        .prepare('UPDATE role_recommendations SET complete = 0 WHERE id = ?')
        .run(recommendation.id),
    ).toThrow(/immutable/);
  });
});

const at = '2026-07-28T12:00:00.000Z';
