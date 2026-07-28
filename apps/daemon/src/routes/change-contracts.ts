import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ChangeContractService,
  type ContractCommandMetadata,
  type ContractCommandResult,
  type ContractQuestion,
  type ReviseContractInput,
  type UnhashedChangeContract,
} from '@roleflock/change-contracts';
import { sha256Canonical, SystemClock } from '@roleflock/contracts';
import {
  ChangeContractRepository,
  ContractVersionConflictError,
  EventStore,
  ProjectRepository,
  TaskRepository,
  type SqliteDb,
} from '@roleflock/database';
import type { EventBus } from '../services/event-bus.js';

type ContractSemanticInput = Pick<
  UnhashedChangeContract,
  | 'objective'
  | 'acceptanceCriteria'
  | 'prohibitedOutcomes'
  | 'outOfScope'
  | 'risk'
  | 'requiredEvidence'
  | 'authoritySources'
  | 'unresolvedQuestions'
>;

export function registerChangeContractRoutes(
  app: FastifyInstance,
  db: SqliteDb,
  bus: EventBus,
): void {
  const contracts = new ChangeContractRepository(db);
  const service = new ChangeContractService(contracts, new SystemClock());
  const events = new EventStore(db);
  const tasks = new TaskRepository(db);
  const projects = new ProjectRepository(db);

  app.post('/api/tasks/:taskId/change-contract', async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    const task = tasks.get(taskId);
    if (task === undefined)
      return reply.code(404).send(apiError('TASK_NOT_FOUND', 'Task not found'));
    const project = projects.get(task.projectId);
    if (project === undefined) {
      return reply.code(409).send(apiError('PROJECT_NOT_FOUND', 'Task project is missing'));
    }

    const body = request.body as Partial<ContractSemanticInput>;
    const idempotency = requireIdempotency(request, reply);
    if (idempotency === undefined) return;
    const requestHash = commandRequestHash('create', taskId, undefined, body);
    const existing = contracts.getByTask(taskId);
    if (existing !== undefined) {
      return replayOrConflict(reply, contracts, events, existing.id, idempotency, requestHash);
    }

    const createdAt = new Date().toISOString();
    const input: UnhashedChangeContract = {
      id: `contract_${randomUUID()}`,
      taskId,
      projectId: task.projectId,
      repositoryId: task.projectId,
      version: 1,
      status: 'draft',
      objective: body.objective as string,
      acceptanceCriteria: body.acceptanceCriteria ?? [],
      prohibitedOutcomes: body.prohibitedOutcomes ?? [],
      outOfScope: body.outOfScope ?? [],
      risk: body.risk ?? task.risk,
      requiredEvidence: body.requiredEvidence ?? [],
      authoritySources: body.authoritySources ?? [],
      unresolvedQuestions: body.unresolvedQuestions ?? [],
      draftedBy: actorId(request),
      createdAt,
    };

    return runCommand(
      reply,
      bus,
      () => service.createDraft(input, commandMetadata(request, idempotency, requestHash)),
      201,
    );
  });

  app.get('/api/tasks/:taskId/change-contract', async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    const aggregate = contracts.getByTask(taskId);
    if (aggregate === undefined) {
      return reply
        .code(404)
        .send(apiError('CHANGE_CONTRACT_NOT_FOUND', 'Change Contract not found'));
    }
    const stored = contracts.getCurrent(aggregate.id);
    if (stored === undefined) {
      return reply
        .code(500)
        .send(apiError('CHANGE_CONTRACT_CORRUPT', 'Current Change Contract version is missing'));
    }
    reply.header('etag', revisionEtag(aggregate.revision));
    return { aggregate, contract: stored.contract };
  });

  app.get('/api/change-contracts/:contractId/versions', async (request, reply) => {
    const contractId = (request.params as { contractId: string }).contractId;
    const aggregate = contracts.getAggregate(contractId);
    if (aggregate === undefined) {
      return reply
        .code(404)
        .send(apiError('CHANGE_CONTRACT_NOT_FOUND', 'Change Contract not found'));
    }
    reply.header('etag', revisionEtag(aggregate.revision));
    return { aggregate, versions: contracts.listVersions(contractId) };
  });

  app.patch('/api/change-contracts/:contractId/draft', async (request, reply) => {
    const contractId = (request.params as { contractId: string }).contractId;
    const expectedRevision = requireRevision(request, reply);
    if (expectedRevision === undefined) return;
    const idempotency = requireIdempotency(request, reply);
    if (idempotency === undefined) return;
    const body = request.body as Partial<ContractSemanticInput>;
    const current = contracts.getCurrent(contractId);
    if (current === undefined) return contractNotFound(reply);
    const requestHash = commandRequestHash('update_draft', contractId, expectedRevision, body);
    const replay = findReplay(reply, contracts, events, contractId, idempotency, requestHash);
    if (replay !== undefined) return replay;

    const base = withoutHash(current.contract);
    const input: UnhashedChangeContract = {
      ...base,
      objective: body.objective ?? base.objective,
      acceptanceCriteria: body.acceptanceCriteria ?? base.acceptanceCriteria,
      prohibitedOutcomes: body.prohibitedOutcomes ?? base.prohibitedOutcomes,
      outOfScope: body.outOfScope ?? base.outOfScope,
      risk: body.risk ?? base.risk,
      requiredEvidence: body.requiredEvidence ?? base.requiredEvidence,
      authoritySources: body.authoritySources ?? base.authoritySources,
      unresolvedQuestions: body.unresolvedQuestions ?? base.unresolvedQuestions,
    };
    return runCommand(reply, bus, () =>
      service.updateDraft(
        input,
        expectedRevision,
        commandMetadata(request, idempotency, requestHash),
      ),
    );
  });

  app.post('/api/change-contracts/:contractId/clarifications', async (request, reply) => {
    const contractId = (request.params as { contractId: string }).contractId;
    const expectedRevision = requireRevision(request, reply);
    if (expectedRevision === undefined) return;
    const idempotency = requireIdempotency(request, reply);
    if (idempotency === undefined) return;
    const body = request.body as { questions?: ContractQuestion[] };
    const requestHash = commandRequestHash(
      'request_clarification',
      contractId,
      expectedRevision,
      body,
    );
    const replay = findReplay(reply, contracts, events, contractId, idempotency, requestHash);
    if (replay !== undefined) return replay;

    return runCommand(reply, bus, () =>
      service.requestClarification(
        contractId,
        body.questions ?? [],
        expectedRevision,
        commandMetadata(request, idempotency, requestHash),
      ),
    );
  });

  app.post('/api/change-contracts/:contractId/authorisation-request', async (request, reply) => {
    const contractId = (request.params as { contractId: string }).contractId;
    const expectedRevision = requireRevision(request, reply);
    if (expectedRevision === undefined) return;
    const idempotency = requireIdempotency(request, reply);
    if (idempotency === undefined) return;
    const requestHash = commandRequestHash(
      'request_authorisation',
      contractId,
      expectedRevision,
      {},
    );
    const replay = findReplay(reply, contracts, events, contractId, idempotency, requestHash);
    if (replay !== undefined) return replay;
    return runCommand(reply, bus, () =>
      service.requestAuthorisation(
        contractId,
        expectedRevision,
        commandMetadata(request, idempotency, requestHash),
      ),
    );
  });

  app.post('/api/change-contracts/:contractId/authorise', async (request, reply) => {
    const contractId = (request.params as { contractId: string }).contractId;
    const expectedRevision = requireRevision(request, reply);
    if (expectedRevision === undefined) return;
    const idempotency = requireIdempotency(request, reply);
    if (idempotency === undefined) return;
    const requestHash = commandRequestHash('authorise', contractId, expectedRevision, {});
    const replay = findReplay(reply, contracts, events, contractId, idempotency, requestHash);
    if (replay !== undefined) return replay;
    return runCommand(reply, bus, () =>
      service.authorise(
        contractId,
        expectedRevision,
        commandMetadata(request, idempotency, requestHash),
      ),
    );
  });

  app.post('/api/change-contracts/:contractId/revisions', async (request, reply) => {
    const contractId = (request.params as { contractId: string }).contractId;
    const expectedRevision = requireRevision(request, reply);
    if (expectedRevision === undefined) return;
    const idempotency = requireIdempotency(request, reply);
    if (idempotency === undefined) return;
    const body = request.body as ReviseContractInput;
    const requestHash = commandRequestHash('revise', contractId, expectedRevision, body);
    const replay = findReplay(reply, contracts, events, contractId, idempotency, requestHash);
    if (replay !== undefined) return replay;
    return runCommand(
      reply,
      bus,
      () =>
        service.revise(
          contractId,
          body,
          expectedRevision,
          commandMetadata(request, idempotency, requestHash),
        ),
      201,
    );
  });
}

function commandMetadata(
  request: FastifyRequest,
  idempotencyKey: string,
  requestHash: string,
): ContractCommandMetadata {
  return {
    actorId: actorId(request),
    idempotencyKey,
    requestHash,
  };
}

function actorId(request: FastifyRequest): string {
  const header = singleHeader(request.headers['x-roleflock-actor-id']);
  return header?.trim().slice(0, 160) || 'local-user';
}

function requireIdempotency(request: FastifyRequest, reply: FastifyReply): string | undefined {
  const key = singleHeader(request.headers['idempotency-key'])?.trim();
  if (key === undefined || key.length === 0 || key.length > 200) {
    reply
      .code(400)
      .send(
        apiError(
          'IDEMPOTENCY_KEY_REQUIRED',
          'A non-empty Idempotency-Key header of at most 200 characters is required',
        ),
      );
    return undefined;
  }
  return key;
}

function requireRevision(request: FastifyRequest, reply: FastifyReply): number | undefined {
  const header = singleHeader(request.headers['if-match']);
  if (header === undefined) {
    reply
      .code(428)
      .send(apiError('REVISION_PRECONDITION_REQUIRED', 'If-Match revision header is required'));
    return undefined;
  }
  const match = /^(?:W\/)?"?(\d+)"?$/.exec(header.trim());
  const revision = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    reply
      .code(400)
      .send(apiError('INVALID_REVISION', 'If-Match must contain a positive integer revision'));
    return undefined;
  }
  return revision;
}

function runCommand(
  reply: FastifyReply,
  bus: EventBus,
  command: () => ContractCommandResult,
  successCode = 200,
): unknown {
  try {
    const result = command();
    reply.header('etag', revisionEtag(result.aggregate.revision));
    bus.publish(result.event.eventType, result.event);
    return reply.code(successCode).send({ ...result, replayed: false });
  } catch (error) {
    if (error instanceof ContractVersionConflictError) {
      return reply.code(409).send({
        ...apiError('CONTRACT_REVISION_CONFLICT', error.message),
        expectedRevision: error.expectedRevision,
        actualRevision: error.actualRevision,
      });
    }
    if (isValidationError(error)) {
      return reply.code(422).send({
        ...apiError('INVALID_CHANGE_CONTRACT', 'Change Contract validation failed'),
        issues: error.issues,
      });
    }
    const message = error instanceof Error ? error.message : 'Change Contract command failed';
    const status = /does not exist|not found/i.test(message) ? 404 : 409;
    return reply.code(status).send(apiError('CHANGE_CONTRACT_COMMAND_REJECTED', message));
  }
}

function replayOrConflict(
  reply: FastifyReply,
  contracts: ChangeContractRepository,
  events: EventStore,
  contractId: string,
  idempotencyKey: string,
  requestHash: string,
): unknown {
  const replay = findReplay(reply, contracts, events, contractId, idempotencyKey, requestHash);
  if (replay !== undefined) return replay;
  return reply
    .code(409)
    .send(apiError('CHANGE_CONTRACT_EXISTS', 'Task already has a Change Contract'));
}

function findReplay(
  reply: FastifyReply,
  contracts: ChangeContractRepository,
  events: EventStore,
  contractId: string,
  idempotencyKey: string,
  requestHash: string,
): unknown | undefined {
  const event = events.findByIdempotencyKey(contractId, idempotencyKey);
  if (event === undefined) return undefined;
  if (event.metadata.requestHash !== requestHash) {
    return reply
      .code(409)
      .send(
        apiError(
          'IDEMPOTENCY_KEY_REUSED',
          'Idempotency-Key was already used for a different request',
        ),
      );
  }
  const aggregate = contracts.getAggregate(contractId);
  const version = Number(event.payload.version);
  const stored = Number.isSafeInteger(version)
    ? contracts.getVersion(contractId, version)
    : contracts.getCurrent(contractId);
  if (aggregate === undefined || stored === undefined) {
    return reply
      .code(500)
      .send(apiError('CHANGE_CONTRACT_CORRUPT', 'Idempotent command result is missing'));
  }
  reply.header('etag', revisionEtag(aggregate.revision));
  return reply.send({
    aggregate,
    contract: stored.contract,
    event,
    replayed: true,
  });
}

function commandRequestHash(
  operation: string,
  targetId: string,
  expectedRevision: number | undefined,
  body: unknown,
): string {
  return sha256Canonical({ operation, targetId, expectedRevision, body });
}

function revisionEtag(revision: number): string {
  return `"${revision}"`;
}

function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function contractNotFound(reply: FastifyReply): unknown {
  return reply.code(404).send(apiError('CHANGE_CONTRACT_NOT_FOUND', 'Change Contract not found'));
}

function apiError(code: string, error: string): { code: string; error: string } {
  return { code, error };
}

function isValidationError(error: unknown): error is { issues: unknown[] } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'issues' in error &&
    Array.isArray((error as { issues?: unknown }).issues)
  );
}

function withoutHash(
  contract: {
    hash: string;
    hashAlgorithm: 'sha256';
  } & UnhashedChangeContract,
): UnhashedChangeContract {
  const { hash: _hash, hashAlgorithm: _hashAlgorithm, ...unhashed } = contract;
  return unhashed;
}
