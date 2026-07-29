import type { FastifyInstance } from 'fastify';
import { VerificationResultRepository, type SqliteDb } from '@roleflock/database';

export function registerVerificationResultRoutes(app: FastifyInstance, db: SqliteDb): void {
  const results = new VerificationResultRepository(db);
  app.get('/api/tasks/:taskId/verification-result', async (request) => {
    const taskId = (request.params as { taskId: string }).taskId;
    return results.getLatest(taskId) ?? null;
  });
}
