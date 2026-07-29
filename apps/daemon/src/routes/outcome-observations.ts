import type { FastifyInstance } from 'fastify';
import { OutcomeObservationRepository, TaskRepository, type SqliteDb } from '@roleflock/database';
import {
  calculateRolePerformance,
  normalizeTaskClass,
  postMergeFailurePenalty,
  type SealedPostMergeOutcome,
  type SealedOutcomeObservation,
} from '@roleflock/role-recommender';

export function registerOutcomeObservationRoutes(
  app: FastifyInstance,
  db: SqliteDb,
): void {
  const tasks = new TaskRepository(db);
  const observations = new OutcomeObservationRepository(db);

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
    const postMerge = cohort.flatMap((observation) =>
      observations.listPostMerge(observation.observationId),
    );
    return {
      filters: {
        classKey: query.classKey,
        roleId: query.roleId,
        providerId: query.providerId,
        modelId: query.modelId,
      },
      analytics: calculateRolePerformance(cohort),
      postMerge: postMergeFailurePenalty(postMerge),
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
}
