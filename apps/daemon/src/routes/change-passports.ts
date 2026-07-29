import type { FastifyInstance } from 'fastify';
import { buildReviewPacket, decodeChangePassportPayload } from '@roleflock/change-passport';
import {
  ChangePassportRepository,
  RunnerIdentityRepository,
  VerificationResultRepository,
  type SqliteDb,
} from '@roleflock/database';

export function registerChangePassportRoutes(app: FastifyInstance, db: SqliteDb): void {
  const passports = new ChangePassportRepository(db);
  const identities = new RunnerIdentityRepository(db);
  const verificationResults = new VerificationResultRepository(db);

  app.get('/api/tasks/:taskId/change-passport', async (request) => {
    const taskId = (request.params as { taskId: string }).taskId;
    const passport = passports.getLatestByTask(taskId);
    if (!passport) return null;
    const payload = decodeChangePassportPayload(passport.envelope);
    const identity = identities.get(passport.issuerIdentityId);
    if (!identity)
      throw new Error(`Passport issuer identity is unavailable: ${passport.passportId}`);
    const verification = verificationResults.getLatest(taskId);
    const revocation = passports.getRevocation(passport.passportId);
    return {
      passport,
      payload,
      identity,
      revocation,
      reviewPacket: buildReviewPacket({
        payload,
        issuerIdentity: identity,
        decision: verification?.decision,
      }),
    };
  });

  app.get('/api/change-passports/:passportId/export', async (request, reply) => {
    const passportId = (request.params as { passportId: string }).passportId;
    const passport = passports.get(passportId);
    if (!passport) return reply.code(404).send({ code: 'PASSPORT_NOT_FOUND' });
    reply.header('content-disposition', `attachment; filename="${safeFilename(passportId)}.json"`);
    return passport.envelope;
  });
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}
