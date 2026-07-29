import type { FastifyInstance } from 'fastify';
import {
  OutcomeObservationRepository,
  TaskRepository,
  type SqliteDb,
} from '@roleflock/database';
import {
  normalizeTaskClass,
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
}
