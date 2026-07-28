import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ArtifactReferenceSchema,
  PlanDeviationTypeSchema,
  compilePlannerPlanProposal,
  sealPlanDeviation,
} from '@roleflock/change-contracts';
import {
  ChangeContractRepository,
  ExecutionPlanRepository,
  TaskRepository,
  planSnapshotId,
  type SqliteDb,
} from '@roleflock/database';
import type { EventBus } from '../services/event-bus.js';
import { findTaskPathCollisions } from '../services/path-collision.js';

export function registerExecutionPlanRoutes(
  app: FastifyInstance,
  db: SqliteDb,
  bus: EventBus,
): void {
  const plans = new ExecutionPlanRepository(db);
  const contracts = new ChangeContractRepository(db);
  const tasks = new TaskRepository(db);

  app.post('/api/tasks/:taskId/execution-plan', async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    if (tasks.get(taskId) === undefined) return reply.code(404).send(error('TASK_NOT_FOUND'));
    if (plans.getByTask(taskId) !== undefined) {
      return reply.code(409).send(error('EXECUTION_PLAN_EXISTS'));
    }
    const contract = currentAuthorisedContract(taskId, contracts);
    if (contract === undefined) {
      return reply.code(409).send(error('AUTHORISED_CONTRACT_REQUIRED'));
    }
    try {
      const plan = compilePlannerPlanProposal({
        output: JSON.stringify(request.body),
        planId: `plan_${randomUUID()}`,
        version: 1,
        contract,
        proposedBy: invocation(request, 'planner'),
      });
      const aggregate = plans.create(plan);
      bus.publish('execution_plan.proposed', {
        taskId,
        planId: plan.id,
        planHash: plan.hash,
        version: plan.version,
      });
      reply.header('etag', `"${aggregate.revision}"`);
      return reply.code(201).send({ aggregate, plan, deviations: [] });
    } catch (reason) {
      return reply.code(422).send(error('EXECUTION_PLAN_INVALID', reason));
    }
  });

  app.get('/api/tasks/:taskId/execution-plan', async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    const current = plans.getByTask(taskId);
    if (current === undefined) return reply.code(404).send(error('EXECUTION_PLAN_NOT_FOUND'));
    reply.header('etag', `"${current.aggregate.revision}"`);
    return {
      ...current,
      snapshots: plans.listSnapshots(current.plan.id),
      deviations: plans.listDeviations(taskId),
      collisions: findTaskPathCollisions(db, taskId),
    };
  });

  app.post('/api/execution-plans/:planId/approve', async (request, reply) => {
    const planId = (request.params as { planId: string }).planId;
    const revision = expectedRevision(request);
    if (revision === undefined) return reply.code(428).send(error('IF_MATCH_REQUIRED'));
    try {
      const approved = plans.approve(
        planId,
        revision,
        { actorId: actorId(request), actorType: 'human' },
        new Date().toISOString(),
      );
      bus.publish('execution_plan.approved', {
        taskId: approved.aggregate.taskId,
        planId,
        planHash: approved.plan.hash,
        version: approved.plan.version,
      });
      reply.header('etag', `"${approved.aggregate.revision}"`);
      return { ...approved, deviations: plans.listDeviations(approved.aggregate.taskId) };
    } catch (reason) {
      return reply.code(409).send(error('EXECUTION_PLAN_APPROVAL_FAILED', reason));
    }
  });

  app.post('/api/execution-plans/:planId/revisions', async (request, reply) => {
    const planId = (request.params as { planId: string }).planId;
    const revision = expectedRevision(request);
    if (revision === undefined) return reply.code(428).send(error('IF_MATCH_REQUIRED'));
    const current = plans.getCurrent(planId);
    if (current === undefined) return reply.code(404).send(error('EXECUTION_PLAN_NOT_FOUND'));
    const contract = currentAuthorisedContract(current.aggregate.taskId, contracts);
    if (contract === undefined) {
      return reply.code(409).send(error('AUTHORISED_CONTRACT_REQUIRED'));
    }
    const body = request.body as Record<string, unknown>;
    if (typeof body.revisionReason !== 'string' || !body.revisionReason.trim()) {
      return reply.code(400).send(error('REVISION_REASON_REQUIRED'));
    }
    const { revisionReason, ...proposal } = body;
    try {
      const plan = compilePlannerPlanProposal({
        output: JSON.stringify(proposal),
        planId,
        version: current.plan.version + 1,
        contract,
        proposedBy: invocation(request, 'planner'),
        lineage: {
          parentPlanId: planSnapshotId(current.plan),
          revisionReason: revisionReason.trim(),
        },
      });
      const revised = plans.revise(planId, revision, plan);
      bus.publish('execution_plan.revised', {
        taskId: revised.aggregate.taskId,
        planId,
        planHash: plan.hash,
        version: plan.version,
      });
      reply.header('etag', `"${revised.aggregate.revision}"`);
      return reply.code(201).send({
        ...revised,
        deviations: plans.listDeviations(revised.aggregate.taskId),
      });
    } catch (reason) {
      return reply.code(422).send(error('EXECUTION_PLAN_REVISION_INVALID', reason));
    }
  });

  app.post('/api/execution-plans/:planId/deviations', async (request, reply) => {
    const planId = (request.params as { planId: string }).planId;
    const current = plans.getCurrent(planId);
    if (current === undefined) return reply.code(404).send(error('EXECUTION_PLAN_NOT_FOUND'));
    const body = request.body as Record<string, unknown>;
    try {
      if (
        body.proposedOptions !== undefined &&
        (!Array.isArray(body.proposedOptions) ||
          body.proposedOptions.some((option) => typeof option !== 'string'))
      ) {
        throw new Error('proposedOptions must be an array of strings');
      }
      const deviation = sealPlanDeviation({
        id: `deviation_${randomUUID()}`,
        planId,
        planHash: current.plan.hash,
        detectedBy:
          body.detectedBy === 'executor' ||
          body.detectedBy === 'runtime' ||
          body.detectedBy === 'verifier'
            ? body.detectedBy
            : 'human',
        type: PlanDeviationTypeSchema.parse(body.type),
        evidence: ArtifactReferenceSchema.array().min(1).parse(body.evidence),
        proposedOptions: (body.proposedOptions as string[] | undefined) ?? [],
        status: 'open',
      });
      plans.addDeviation(current.aggregate.taskId, deviation, new Date().toISOString());
      bus.publish('execution_plan.deviation_opened', {
        taskId: current.aggregate.taskId,
        planId,
        deviationId: deviation.id,
        type: deviation.type,
      });
      return reply.code(201).send({ deviation });
    } catch (reason) {
      return reply.code(422).send(error('PLAN_DEVIATION_INVALID', reason));
    }
  });
}

function currentAuthorisedContract(taskId: string, contracts: ChangeContractRepository) {
  const aggregate = contracts.getByTask(taskId);
  if (aggregate === undefined) return undefined;
  const current = contracts.getCurrent(aggregate.id)?.contract;
  return current?.status === 'authorised' && current.hash === aggregate.currentHash
    ? current
    : undefined;
}

function expectedRevision(request: FastifyRequest): number | undefined {
  const value = request.headers['if-match'];
  if (typeof value !== 'string') return undefined;
  const parsed = Number(value.replaceAll('"', ''));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function actorId(request: FastifyRequest): string {
  const value = request.headers['x-roleflock-actor-id'];
  return typeof value === 'string' && value.trim() ? value.trim() : 'local-user';
}

function invocation(request: FastifyRequest, role: string) {
  return {
    invocationId:
      typeof request.headers['x-roleflock-invocation-id'] === 'string'
        ? request.headers['x-roleflock-invocation-id']
        : `manual_${randomUUID()}`,
    role,
    providerId:
      typeof request.headers['x-roleflock-provider-id'] === 'string'
        ? request.headers['x-roleflock-provider-id']
        : 'manual',
    modelId:
      typeof request.headers['x-roleflock-model-id'] === 'string'
        ? request.headers['x-roleflock-model-id']
        : actorId(request),
  };
}

function error(code: string, reason?: unknown) {
  return {
    code,
    error: reason instanceof Error ? reason.message : code.replaceAll('_', ' ').toLowerCase(),
  };
}
