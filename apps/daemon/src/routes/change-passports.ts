import type { FastifyInstance } from 'fastify';
import {
  buildReviewPacket,
  decodeChangePassportPayload,
  ChangePassportService,
  LocalRunnerIdentityService,
  verifySignedChangePassport,
} from '@roleflock/change-passport';
import {
  ChangePassportRepository,
  RunnerIdentityRepository,
  VerificationResultRepository,
  type SqliteDb,
} from '@roleflock/database';
import { LocalSecretStore } from '../services/local-secret-store.js';

export function registerChangePassportRoutes(
  app: FastifyInstance,
  db: SqliteDb,
  dataDir: string,
): void {
  const passports = new ChangePassportRepository(db);
  const identities = new RunnerIdentityRepository(db);
  const verificationResults = new VerificationResultRepository(db);
  const signer = new ChangePassportService(
    passports,
    new LocalRunnerIdentityService(identities, new LocalSecretStore(dataDir, 'runner-signing')),
  );

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

  /**
   * Re-verifies a stored passport from its own bytes.
   *
   * Deliberately repeats the whole check — signature, identity window, subject,
   * revocation — rather than trusting the verdict column written at issuance,
   * so a row edited after the fact cannot present itself as valid.
   */
  app.post('/api/change-passports/:passportId/verify', async (request, reply) => {
    const passportId = (request.params as { passportId: string }).passportId;
    const passport = passports.get(passportId);
    if (!passport) return reply.code(404).send({ code: 'PASSPORT_NOT_FOUND' });
    const identity = identities.get(passport.issuerIdentityId);
    if (!identity) return reply.code(409).send({ code: 'ISSUER_IDENTITY_UNAVAILABLE' });
    const revocation = passports.getRevocation(passportId);
    const payload = decodeChangePassportPayload(passport.envelope);
    return verifySignedChangePassport({
      envelope: passport.envelope,
      identity,
      expectedSubject: payload.subject,
      ...(revocation ? { revocation } : { revocationSourceCurrent: true }),
    });
  });

  app.post('/api/change-passports/:passportId/revoke', async (request, reply) => {
    const passportId = (request.params as { passportId: string }).passportId;
    const body = (request.body ?? {}) as { reason?: string };
    const reason = body.reason?.trim();
    if (!reason) return reply.code(400).send({ code: 'REVOCATION_REASON_REQUIRED' });
    if (!passports.get(passportId)) return reply.code(404).send({ code: 'PASSPORT_NOT_FOUND' });
    if (passports.getRevocation(passportId)) {
      return reply.code(409).send({ code: 'PASSPORT_ALREADY_REVOKED' });
    }
    return signer.revoke({ passportId, reason, revokedBy: 'local-user' });
  });
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}
