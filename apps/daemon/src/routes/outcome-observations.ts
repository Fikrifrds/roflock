import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  AdaptiveRoutingControlRepository,
  OutcomeObservationRepository,
  TaskRepository,
  type SqliteDb,
} from '@roleflock/database';
import {
  calculateRolePerformance,
  explainAdaptiveRouting,
  normalizeTaskClass,
  postMergeFailurePenalty,
  type SealedPostMergeOutcome,
  type SealedOutcomeObservation,
} from '@roleflock/role-recommender';

export function registerOutcomeObservationRoutes(app: FastifyInstance, db: SqliteDb): void {
  const tasks = new TaskRepository(db);
  const observations = new OutcomeObservationRepository(db);
  const controls = new AdaptiveRoutingControlRepository(db);

  app.post('/api/tasks/:taskId/outcome-observations', async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    if (!tasks.get(taskId)) return reply.code(404).send({ code: 'TASK_NOT_FOUND' });
    const observation = request.body as SealedOutcomeObservation;
    if (observation.taskId !== taskId) {
      return reply.code(409).send({ code: 'OUTCOME_TASK_MISMATCH' });
    }
    try {
      const result = observations.ingest(observation);
      const classification = normalizeTaskClass(observation.taskClass);
      if (result.status === 'accepted') {
        observations.classify(observation.observationId, classification);
      }
      return { ...result, classification };
    } catch (error) {
      return reply.code(400).send({
        code: 'OUTCOME_OBSERVATION_INVALID',
        error: error instanceof Error ? error.message : 'Invalid outcome observation',
      });
    }
  });

  app.get('/api/tasks/:taskId/outcome-observations', async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    if (!tasks.get(taskId)) return reply.code(404).send({ code: 'TASK_NOT_FOUND' });
    return observations.listByTask(taskId);
  });

  app.get('/api/outcome-analytics', async (request, reply) => {
    const query = request.query as {
      classKey?: string;
      roleId?: string;
      providerId?: string;
      modelId?: string;
      minimumConfidence?: string;
    };
    if (!query.classKey) {
      return reply.code(400).send({ code: 'CLASS_KEY_REQUIRED' });
    }
    const cohort = observations
      .listCohort(query.classKey, Number(query.minimumConfidence ?? 0.8))
      .filter(
        (observation) =>
          (!query.roleId || observation.roleAssignment.roleId === query.roleId) &&
          (!query.providerId || observation.roleAssignment.providerId === query.providerId) &&
          (!query.modelId || observation.roleAssignment.modelId === query.modelId),
      );
    const analytics = calculateRolePerformance(cohort);
    const postMerge = cohort.flatMap((observation) =>
      observations.listPostMerge(observation.observationId),
    );
    const postMergeSummary = postMergeFailurePenalty(postMerge);
    const effectiveControl =
      (query.modelId ? controls.effective('model', query.modelId) : undefined) ??
      controls.effective('cohort', query.classKey);
    const control =
      effectiveControl?.action === 'freeze'
        ? 'frozen'
        : effectiveControl?.action === 'override'
          ? 'overridden'
          : 'default';
    return {
      filters: {
        classKey: query.classKey,
        roleId: query.roleId,
        providerId: query.providerId,
        modelId: query.modelId,
      },
      analytics,
      postMerge: postMergeSummary,
      explanation: explainAdaptiveRouting({
        analytics,
        postMergePenalty: postMergeSummary.penalty,
        control,
      }),
      effectiveControl,
    };
  });

  app.post('/api/outcome-observations/:observationId/post-merge', async (request, reply) => {
    const observationId = (request.params as { observationId: string }).observationId;
    const outcome = request.body as SealedPostMergeOutcome;
    if (outcome.observationId !== observationId) {
      return reply.code(409).send({ code: 'POST_MERGE_OBSERVATION_MISMATCH' });
    }
    try {
      return observations.ingestPostMerge(outcome);
    } catch (error) {
      return reply.code(400).send({
        code: 'POST_MERGE_OUTCOME_INVALID',
        error: error instanceof Error ? error.message : 'Invalid post-merge outcome',
      });
    }
  });

  app.get('/api/outcome-observations/:observationId/post-merge', async (request) => {
    const observationId = (request.params as { observationId: string }).observationId;
    return observations.listPostMerge(observationId);
  });

  app.post('/api/adaptive-routing-controls', async (request) => {
    const body = request.body as Record<string, unknown>;
    return controls.create({
      id: `routing_control_${randomUUID()}`,
      organisationId: optional(body.organisationId),
      projectId: optional(body.projectId),
      targetType: enumValue(
        body.targetType,
        ['observation', 'cohort', 'model', 'routing'],
        'targetType',
      ),
      targetId: required(body.targetId, 'targetId'),
      action: enumValue(
        body.action,
        ['exclude', 'include', 'freeze', 'unfreeze', 'override', 'clear_override'],
        'action',
      ),
      value:
        typeof body.value === 'object' && body.value !== null
          ? (body.value as Record<string, unknown>)
          : undefined,
      reason: required(body.reason, 'reason'),
      actorId: required(body.actorId, 'actorId'),
      createdAt: new Date().toISOString(),
    });
  });

  app.get('/api/adaptive-routing-controls/:targetType/:targetId', async (request) => {
    const { targetType, targetId } = request.params as {
      targetType: 'observation' | 'cohort' | 'model' | 'routing';
      targetId: string;
    };
    return {
      effective: controls.effective(targetType, targetId),
      history: controls.history(targetType, targetId),
    };
  });
}

function required(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

function optional(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
): T[number] {
  const resolved = required(value, field);
  if (!allowed.includes(resolved)) throw new Error(`${field} is invalid`);
  return resolved as T[number];
}
