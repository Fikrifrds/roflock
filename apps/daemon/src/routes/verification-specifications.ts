import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  ChangeContractRepository,
  ExecutionPlanRepository,
  ProjectRepository,
  TaskRepository,
  VerificationSpecificationRepository,
  type SqliteDb,
} from '@roleflock/database';
import {
  TestMutationPolicySchema,
  VerificationCheckSchema,
  VerificationEnvironmentSchema,
  VerificationEvidenceRequirementSchema,
  freezeVerificationSpecification,
  sealVerificationSpecification,
} from '@roleflock/verification-runner';
import { draftVerificationSpecification } from '../services/assurance-draft.js';
import type { EventBus } from '../services/event-bus.js';
import { discoverVerificationCommand } from '../services/verification-command.js';

export function registerVerificationSpecificationRoutes(
  app: FastifyInstance,
  db: SqliteDb,
  bus: EventBus,
): void {
  const tasks = new TaskRepository(db);
  const contracts = new ChangeContractRepository(db);
  const plans = new ExecutionPlanRepository(db);
  const specifications = new VerificationSpecificationRepository(db);
  const projects = new ProjectRepository(db);

  app.get('/api/tasks/:taskId/verification-specification', async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    const specification = specifications.getByTask(taskId);
    if (specification === undefined) {
      return reply.code(404).send({ code: 'VERIFICATION_SPECIFICATION_NOT_FOUND' });
    }
    reply.header('etag', `"${specification.hash}"`);
    return { specification };
  });

  /**
   * The specification that would be frozen for the current approved plan.
   *
   * Reports a missing verification command rather than inventing a check: a
   * specification whose evidence cannot actually be produced is worse than none.
   */
  app.get('/api/tasks/:taskId/verification-specification/draft', async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    const task = tasks.get(taskId);
    if (task === undefined) return reply.code(404).send(error('TASK_NOT_FOUND'));
    const contractAggregate = contracts.getByTask(taskId);
    const contract =
      contractAggregate === undefined
        ? undefined
        : contracts.getCurrent(contractAggregate.id)?.contract;
    if (
      contract === undefined ||
      contract.status !== 'authorised' ||
      contract.hash !== contractAggregate?.currentHash
    ) {
      return reply.code(409).send(error('AUTHORISED_CONTRACT_REQUIRED'));
    }
    const plan = plans.getByTask(taskId)?.plan;
    if (plan === undefined || plan.status !== 'approved' || plan.contractHash !== contract.hash) {
      return reply.code(409).send(error('APPROVED_PLAN_REQUIRED'));
    }
    const project = projects.get(task.projectId);
    const verificationCommand =
      task.verificationCommand?.trim() ||
      (project ? await discoverVerificationCommand(project.resolvedPath) : undefined);
    if (!verificationCommand) {
      return reply.code(409).send(error('VERIFICATION_COMMAND_REQUIRED'));
    }
    return {
      verificationCommand,
      draft: draftVerificationSpecification({ contract, plan, verificationCommand }),
    };
  });

  app.post('/api/tasks/:taskId/verification-specification', async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    if (tasks.get(taskId) === undefined) return reply.code(404).send(error('TASK_NOT_FOUND'));
    if (specifications.getByTask(taskId) !== undefined) {
      return reply.code(409).send(error('VERIFICATION_SPECIFICATION_FROZEN'));
    }
    const contractAggregate = contracts.getByTask(taskId);
    const contract =
      contractAggregate === undefined
        ? undefined
        : contracts.getCurrent(contractAggregate.id)?.contract;
    if (
      contract === undefined ||
      contract.status !== 'authorised' ||
      contract.hash !== contractAggregate?.currentHash
    ) {
      return reply.code(409).send(error('AUTHORISED_CONTRACT_REQUIRED'));
    }
    const plan = plans.getByTask(taskId)?.plan;
    if (plan === undefined || plan.status !== 'approved' || plan.contractHash !== contract.hash) {
      return reply.code(409).send(error('APPROVED_PLAN_REQUIRED'));
    }
    const body = request.body as Record<string, unknown>;
    const approvedAt = new Date().toISOString();
    try {
      const specification = sealVerificationSpecification({
        id: plan.verificationSpecId,
        taskId,
        contractHash: contract.hash,
        planId: plan.id,
        planHash: plan.hash,
        version: 1,
        status: 'approved',
        checks: VerificationCheckSchema.array().min(1).parse(body.checks),
        environment: VerificationEnvironmentSchema.parse(body.environment),
        testMutationPolicy: TestMutationPolicySchema.parse(body.testMutationPolicy),
        minimumEvidence: VerificationEvidenceRequirementSchema.array()
          .min(1)
          .parse(body.minimumEvidence),
        authoredBy: invocation(request),
        approvedBy: { actorId: actorId(request), actorType: 'human' },
        approvedAt,
      });
      freezeVerificationSpecification(specification, contract, plan);
      specifications.create(specification, approvedAt);
      bus.publish('verification_specification.frozen', {
        taskId,
        specificationId: specification.id,
        specificationHash: specification.hash,
        contractHash: contract.hash,
        planHash: plan.hash,
      });
      reply.header('etag', `"${specification.hash}"`);
      return reply.code(201).send({ specification });
    } catch (reason) {
      return reply.code(422).send(error('VERIFICATION_SPECIFICATION_INVALID', reason));
    }
  });
}

function actorId(request: FastifyRequest): string {
  const value = request.headers['x-roleflock-actor-id'];
  return typeof value === 'string' && value.trim() ? value.trim() : 'local-user';
}

function invocation(request: FastifyRequest) {
  return {
    invocationId:
      typeof request.headers['x-roleflock-invocation-id'] === 'string'
        ? request.headers['x-roleflock-invocation-id']
        : `manual_${randomUUID()}`,
    role: 'test_planner',
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
