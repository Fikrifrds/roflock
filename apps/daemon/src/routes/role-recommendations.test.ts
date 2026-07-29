import fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AuditRepository,
  RoleRecommendationRepository,
  TaskRepository,
  migrate,
  openDatabase,
  type RoleCandidateInput,
  type SqliteDb,
} from '@roleflock/database';
import { DEFAULT_CURATED_PROFILE_BUNDLE } from '@roleflock/role-recommender/curated-bundle';
import type { RoleRouter } from '../services/role-routing.js';
import type { ProviderRegistry } from '../services/provider-registry.js';
import type { RoutedRole } from '../services/role-defaults.js';
import { registerRoleRecommendationRoutes } from './role-recommendations.js';

let db: SqliteDb | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
});

describe('role recommendation API', () => {
  it('generates, retrieves and idempotently applies an audited roster', async () => {
    db = openDatabase({ path: ':memory:' });
    migrate(db);
    new TaskRepository(db).upsert({
      id: 'task_1',
      projectId: 'project_1',
      type: 'feature',
      title: 'Feature',
      brief: 'Implement a feature.',
      risk: 'medium',
      state: 'draft',
      workflowGraphVersionId: 'graph_1',
      budgetPolicyId: 'budget_1',
      maxAttempts: 3,
      createdAt: at,
      updatedAt: at,
    });
    const applied: Array<{ role: RoutedRole; candidates: RoleCandidateInput[] }> = [];
    const router = {
      activeCooldowns: () => [],
      replaceRole: (role: RoutedRole, candidates: RoleCandidateInput[]) => {
        applied.push({ role, candidates });
        return [];
      },
    } as unknown as RoleRouter;
    const providers = {
      list: async () => [
        { id: 'codex', status: 'ready' },
        { id: 'claude', status: 'ready' },
      ],
      models: async (providerId: string) =>
        DEFAULT_CURATED_PROFILE_BUNDLE.profiles
          .filter((profile) => profile.providerId === providerId)
          .map((profile) => ({ id: profile.modelId, displayName: profile.modelId })),
    } as unknown as ProviderRegistry;
    const app = fastify();
    registerRoleRecommendationRoutes(app, db, providers, router);

    const generated = await app.inject({
      method: 'POST',
      url: '/api/tasks/task_1/role-recommendations',
      headers: { 'idempotency-key': 'generate-1' },
    });
    expect(generated.statusCode).toBe(201);
    const stored = generated.json() as {
      recommendation: { id: string; complete: boolean; profileBundleVersion: string };
      revision: number;
    };
    expect(stored.recommendation).toMatchObject({
      complete: true,
      profileBundleVersion: '2026.7.1',
    });
    expect(stored.revision).toBe(0);

    const appliedResponse = await app.inject({
      method: 'POST',
      url: `/api/role-recommendations/${stored.recommendation.id}/apply`,
      headers: { 'idempotency-key': 'apply-1', 'if-match': '0' },
    });
    expect(appliedResponse.statusCode).toBe(200);
    expect(new Set(applied.map((entry) => entry.role))).toEqual(
      new Set(['planner', 'reviewer', 'writer', 'verifier']),
    );
    const applyCount = applied.length;

    const replay = await app.inject({
      method: 'POST',
      url: `/api/role-recommendations/${stored.recommendation.id}/apply`,
      headers: { 'idempotency-key': 'apply-1', 'if-match': '0' },
    });
    expect(replay.statusCode).toBe(200);
    expect(applied).toHaveLength(applyCount);
    const repository = new RoleRecommendationRepository(db);
    expect(repository.get(stored.recommendation.id)?.revision).toBe(1);
    const alternative = repository
      .get(stored.recommendation.id)!
      .recommendation.candidates.find(
        (candidate) => candidate.role === 'planner' && candidate.eligible && !candidate.selected,
      );
    expect(alternative).toBeDefined();
    const overridden = await app.inject({
      method: 'POST',
      url: `/api/role-recommendations/${stored.recommendation.id}/override`,
      headers: { 'idempotency-key': 'override-1', 'if-match': '1' },
      payload: {
        role: 'planner',
        providerId: alternative!.providerId,
        modelId: alternative!.modelId,
        reason: 'Use the lower-cost eligible planner for this task.',
      },
    });
    expect(overridden.statusCode).toBe(200);
    expect(repository.get(stored.recommendation.id)).toMatchObject({
      revision: 2,
      actions: [
        { action: 'applied' },
        {
          action: 'overridden',
          role: 'planner',
          reason: 'Use the lower-cost eligible planner for this task.',
        },
      ],
    });
    expect(
      new AuditRepository(db).listByTarget('task', 'task_1').map((event) => event.action),
    ).toEqual([
      'role.recommendation.generated',
      'role.recommendation.applied',
      'role.recommendation.overridden',
    ]);
    await app.close();
  });
});

const at = '2026-07-28T12:00:00.000Z';
