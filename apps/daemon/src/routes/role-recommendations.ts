import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  AuditRepository,
  RecommendationIdempotencyConflictError,
  RecommendationVersionConflictError,
  RoleRecommendationRepository,
  TaskRepository,
  type RecommendationRosterEntry,
  type RoleCandidateInput,
  type SqliteDb,
} from '@roleflock/database';
import {
  generateRoleRecommendation,
  validateRecommendationFallbackMatrix,
  validateRecommendationRoster,
  type RecommendedRole,
  type RoleRecommendation,
} from '@roleflock/role-recommender';
import type { ProviderModel } from '@roleflock/provider-core';
import {
  DEFAULT_CURATED_PROFILE_BUNDLE,
  loadCuratedProfileBundle,
} from '@roleflock/role-recommender/curated-bundle';
import type { RoleRouter } from '../services/role-routing.js';
import type { ProviderRegistry } from '../services/provider-registry.js';
import type { RoutedRole } from '../services/role-defaults.js';

const ROUTED_ROLE: Record<RecommendedRole, RoutedRole> = {
  planner: 'planner',
  plan_critic: 'reviewer',
  executor: 'writer',
  verifier: 'verifier',
};

export function registerRoleRecommendationRoutes(
  app: FastifyInstance,
  db: SqliteDb,
  providers: ProviderRegistry,
  router: RoleRouter,
): void {
  const tasks = new TaskRepository(db);
  const recommendations = new RoleRecommendationRepository(db);
  const audit = new AuditRepository(db);

  app.post('/api/tasks/:taskId/role-recommendations', async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    const task = tasks.get(taskId);
    if (!task) return reply.code(404).send({ code: 'TASK_NOT_FOUND' });
    const idempotencyKey = header(request.headers['idempotency-key']);
    if (!idempotencyKey) {
      return reply.code(428).send({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    }
    const recommendationId = deterministicRecommendationId(taskId, idempotencyKey);
    const existing = recommendations.get(recommendationId);
    if (existing) return existing;

    const bundle = loadCuratedProfileBundle(DEFAULT_CURATED_PROFILE_BUNDLE);
    const [providerList, cooldowns] = await Promise.all([
      providers.list(),
      Promise.resolve(router.activeCooldowns()),
    ]);
    const catalogues = new Map<string, ProviderModel[]>(
      await Promise.all(
        providerList.map(
          async (provider) =>
            [provider.id, await providers.models(provider.id).catch(() => [])] as const,
        ),
      ),
    );
    const providerById = new Map(providerList.map((provider) => [provider.id, provider]));
    const at = new Date().toISOString();
    const runtimeCandidates = bundle.profiles.map((profile) => {
      const provider = providerById.get(profile.providerId);
      const catalogue = catalogues.get(profile.providerId) ?? [];
      const modelListed = catalogue.some((model) => model.id === profile.modelId);
      const cooldown = cooldowns.find(
        (item) =>
          item.providerConnectionId === profile.providerId && item.modelId === profile.modelId,
      );
      return {
        profile,
        health: provider?.status ?? ('missing' as const),
        authenticated: provider?.status === 'ready',
        disabled: provider === undefined || !modelListed,
        ...(cooldown ? { cooldownUntil: cooldown.until } : {}),
        enforceablePermissionModes: [
          'read_only' as const,
          ...(profile.capabilities.writes ? (['planned_write'] as const) : []),
          'restricted_network' as const,
        ],
        availabilityConfidence: provider?.status === 'ready' && modelListed ? 0.9 : 0,
        runnerIds: {
          planner: 'local-agent-runner',
          plan_critic: 'local-agent-runner',
          executor: 'local-writer-runner',
          verifier: 'local-clean-verifier-runner',
        },
      };
    });
    const recommendation = generateRoleRecommendation({
      id: recommendationId,
      taskId,
      risk: task.risk,
      profileBundleVersion: bundle.bundleVersion,
      profileBundleDigest: bundle.digest,
      candidates: runtimeCandidates,
      policy: { now: at },
      generatedAt: at,
    });
    recommendations.recordProfiles(bundle.profiles, bundle.bundleVersion, at);
    const stored = recommendations.create(recommendation);
    audit.append({
      id: randomUUID(),
      actor: 'local-user',
      action: 'role.recommendation.generated',
      targetType: 'task',
      targetId: taskId,
      details: {
        recommendationId,
        inputHash: recommendation.inputHash,
        profileBundleVersion: recommendation.profileBundleVersion,
        complete: recommendation.complete,
      },
      createdAt: at,
    });
    return reply.code(201).send(stored);
  });

  app.get('/api/tasks/:taskId/role-recommendations/latest', async (request) => {
    const taskId = (request.params as { taskId: string }).taskId;
    return recommendations.getLatestByTask(taskId) ?? null;
  });

  app.post('/api/role-recommendations/:id/apply', async (request, reply) => {
    const recommendationId = (request.params as { id: string }).id;
    const stored = recommendations.get(recommendationId);
    if (!stored) return reply.code(404).send({ code: 'ROLE_RECOMMENDATION_NOT_FOUND' });
    if (!rosterCanChange(tasks.get(stored.recommendation.taskId)?.state)) {
      return reply.code(409).send({ code: 'TASK_ROSTER_LOCKED' });
    }
    if (!stored.recommendation.complete) {
      return reply.code(409).send({
        code: 'ROLE_RECOMMENDATION_INCOMPLETE',
        gaps: stored.recommendation.gaps,
      });
    }
    const mutation = mutationHeaders(request.headers);
    if ('error' in mutation) return reply.code(428).send({ code: mutation.error });
    const replay = recommendations.findActionByIdempotency(
      recommendationId,
      mutation.idempotencyKey,
    );
    if (replay) {
      if (replay.action !== 'applied') {
        return reply.code(409).send({ code: 'RecommendationIdempotencyConflictError' });
      }
      return { ...stored, action: replay };
    }
    const roster = selectedRoster(stored.recommendation);
    const rosterDecision = validateRecommendationRoster(stored.recommendation, roster);
    const fallbackDecisions = validateRecommendationFallbackMatrix(stored.recommendation, roster);
    if (!rosterDecision.eligible || fallbackDecisions.some((decision) => !decision.eligible)) {
      return reply.code(409).send({ code: 'ROLE_RECOMMENDATION_ROSTER_INVALID' });
    }
    try {
      const action = db.transaction(() => {
        const result = recommendations.recordAction({
          recommendationId,
          expectedRevision: mutation.expectedRevision,
          action: 'applied',
          actor: 'local-user',
          roster,
          idempotencyKey: mutation.idempotencyKey,
          createdAt: new Date().toISOString(),
        });
        applyRoster(router, stored.recommendation, roster, result.id);
        auditAction(audit, stored.recommendation.taskId, result);
        return result;
      })();
      return { ...recommendations.get(recommendationId), action };
    } catch (error) {
      return recommendationMutationError(reply, error);
    }
  });

  app.post('/api/role-recommendations/:id/override', async (request, reply) => {
    const recommendationId = (request.params as { id: string }).id;
    const stored = recommendations.get(recommendationId);
    if (!stored) return reply.code(404).send({ code: 'ROLE_RECOMMENDATION_NOT_FOUND' });
    if (!rosterCanChange(tasks.get(stored.recommendation.taskId)?.state)) {
      return reply.code(409).send({ code: 'TASK_ROSTER_LOCKED' });
    }
    const mutation = mutationHeaders(request.headers);
    if ('error' in mutation) return reply.code(428).send({ code: mutation.error });
    const body = request.body as {
      role?: RecommendedRole;
      providerId?: string;
      modelId?: string;
      reason?: string;
    };
    const role = body.role;
    const reason = body.reason?.trim();
    if (!role || !reason || !body.providerId || !body.modelId) {
      return reply.code(400).send({
        code: 'OVERRIDE_INPUT_REQUIRED',
        error: 'role, providerId, modelId and reason are required',
      });
    }
    const candidate = stored.recommendation.candidates.find(
      (item) =>
        item.role === role &&
        item.providerId === body.providerId &&
        item.modelId === body.modelId &&
        item.eligible,
    );
    if (!candidate) {
      return reply.code(409).send({
        code: 'OVERRIDE_CANDIDATE_INELIGIBLE',
        error: 'Override candidate must be an eligible candidate from this frozen recommendation',
      });
    }
    const baseRoster = stored.actions.at(-1)?.roster ?? selectedRoster(stored.recommendation);
    const roster = baseRoster.map((entry) =>
      entry.role === role
        ? {
            role,
            providerId: candidate.providerId,
            modelId: candidate.modelId,
            effort: candidate.effort,
          }
        : entry,
    );
    if (!roster.some((entry) => entry.role === role)) {
      roster.push({
        role,
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        effort: candidate.effort,
      });
    }
    const rosterDecision = validateRecommendationRoster(stored.recommendation, roster);
    const fallbackDecisions = validateRecommendationFallbackMatrix(stored.recommendation, roster);
    if (!rosterDecision.eligible || fallbackDecisions.some((decision) => !decision.eligible)) {
      return reply.code(409).send({
        code: 'OVERRIDE_ROSTER_INDEPENDENCE_VIOLATION',
        requiredViolations: [
          ...rosterDecision.independence.requiredViolations,
          ...fallbackDecisions.flatMap((decision) => decision.independence.requiredViolations),
        ],
      });
    }
    const replay = recommendations.findActionByIdempotency(
      recommendationId,
      mutation.idempotencyKey,
    );
    if (replay) {
      if (
        replay.action !== 'overridden' ||
        replay.role !== role ||
        replay.providerId !== candidate.providerId ||
        replay.modelId !== candidate.modelId ||
        replay.reason !== reason
      ) {
        return reply.code(409).send({ code: 'RecommendationIdempotencyConflictError' });
      }
      return { ...stored, action: replay };
    }
    try {
      const action = db.transaction(() => {
        const result = recommendations.recordAction({
          recommendationId,
          expectedRevision: mutation.expectedRevision,
          action: 'overridden',
          actor: 'local-user',
          role,
          providerId: candidate.providerId,
          modelId: candidate.modelId,
          reason,
          roster,
          idempotencyKey: mutation.idempotencyKey,
          createdAt: new Date().toISOString(),
        });
        applyRoster(router, stored.recommendation, roster, result.id);
        auditAction(audit, stored.recommendation.taskId, result);
        return result;
      })();
      return { ...recommendations.get(recommendationId), action };
    } catch (error) {
      return recommendationMutationError(reply, error);
    }
  });
}

function selectedRoster(recommendation: RoleRecommendation): RecommendationRosterEntry[] {
  return recommendation.candidates
    .filter((candidate) => candidate.selected)
    .map((candidate) => ({
      role: candidate.role,
      providerId: candidate.providerId,
      modelId: candidate.modelId,
      effort: candidate.effort,
    }));
}

function applyRoster(
  router: RoleRouter,
  recommendation: RoleRecommendation,
  roster: readonly RecommendationRosterEntry[],
  recommendationActionId: string,
): void {
  for (const entry of roster) {
    const candidates: RoleCandidateInput[] = [
      {
        providerConnectionId: entry.providerId,
        modelId: entry.modelId,
        effort: entry.effort,
      },
      ...recommendation.candidates
        .filter(
          (candidate) =>
            candidate.role === entry.role &&
            candidate.fallback &&
            (candidate.providerId !== entry.providerId || candidate.modelId !== entry.modelId),
        )
        .map((candidate) => ({
          providerConnectionId: candidate.providerId,
          modelId: candidate.modelId,
          effort: candidate.effort,
        })),
    ];
    router.replaceTaskRole(recommendation.taskId, ROUTED_ROLE[entry.role], candidates, {
      recommendationId: recommendation.id,
      recommendationActionId,
    });
  }
}

function mutationHeaders(
  headers: Record<string, string | string[] | undefined>,
):
  | { idempotencyKey: string; expectedRevision: number }
  | { error: 'IDEMPOTENCY_KEY_REQUIRED' | 'IF_MATCH_REQUIRED' } {
  const idempotencyKey = header(headers['idempotency-key']);
  if (!idempotencyKey) return { error: 'IDEMPOTENCY_KEY_REQUIRED' };
  const rawRevision = header(headers['if-match'])?.replaceAll('"', '');
  const expectedRevision = Number(rawRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return { error: 'IF_MATCH_REQUIRED' };
  }
  return { idempotencyKey, expectedRevision };
}

function recommendationMutationError(reply: FastifyReply, error: unknown) {
  if (
    error instanceof RecommendationVersionConflictError ||
    error instanceof RecommendationIdempotencyConflictError
  ) {
    return reply.code(409).send({ code: error.name, error: error.message });
  }
  throw error;
}

function auditAction(
  audit: AuditRepository,
  taskId: string,
  action: {
    id: string;
    action: 'applied' | 'overridden';
    recommendationId: string;
    revision: number;
    role?: RecommendedRole;
    providerId?: string;
    modelId?: string;
    reason?: string;
    createdAt: string;
  },
): void {
  audit.append({
    id: randomUUID(),
    actor: 'local-user',
    action: `role.recommendation.${action.action}`,
    targetType: 'task',
    targetId: taskId,
    details: {
      recommendationId: action.recommendationId,
      recommendationActionId: action.id,
      revision: action.revision,
      role: action.role,
      providerId: action.providerId,
      modelId: action.modelId,
      reason: action.reason,
    },
    createdAt: action.createdAt,
  });
}

function deterministicRecommendationId(taskId: string, idempotencyKey: string): string {
  return `role_rec_${createHash('sha256').update(`${taskId}\0${idempotencyKey}`).digest('hex').slice(0, 32)}`;
}

function header(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function rosterCanChange(state: string | undefined): boolean {
  return state !== undefined && ['draft', 'ready', 'failed', 'cancelled'].includes(state);
}
