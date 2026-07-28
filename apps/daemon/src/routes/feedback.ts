import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { sha256Canonical } from '@roleflock/contracts';
import { FeedbackRepository, TaskRepository, type SqliteDb } from '@roleflock/database';
import {
  classifyFeedbackText,
  feedbackDecisionOwner,
  type FeedbackClass,
} from '@roleflock/role-protocol';
import type { EventBus } from '../services/event-bus.js';

export function registerFeedbackRoutes(app: FastifyInstance, db: SqliteDb, bus: EventBus): void {
  const feedback = new FeedbackRepository(db);
  const tasks = new TaskRepository(db);

  app.post('/api/tasks/:taskId/feedback', async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    if (tasks.get(taskId) === undefined) {
      return reply.code(404).send({ code: 'TASK_NOT_FOUND', error: 'Task not found' });
    }
    const body = request.body as {
      text?: unknown;
      classification?: unknown;
      targetContractHash?: unknown;
      targetPlanHash?: unknown;
      targetCommit?: unknown;
      targetRole?: unknown;
    };
    if (typeof body.text !== 'string' || !body.text.trim()) {
      return reply
        .code(400)
        .send({ code: 'FEEDBACK_TEXT_REQUIRED', error: 'Feedback text is required' });
    }
    if (body.targetRole === 'executor') {
      return reply.code(409).send({
        code: 'RAW_FEEDBACK_EXECUTOR_FORBIDDEN',
        error: 'Raw feedback can never target executor; RoleFlock routes it to a decision owner.',
      });
    }
    const idempotencyKey = request.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
      return reply.code(400).send({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        error: 'idempotency-key header is required',
      });
    }
    const classification =
      body.classification === undefined
        ? classifyFeedbackText(body.text)
        : parseFeedbackClass(body.classification);
    if (classification === undefined) {
      return reply.code(400).send({
        code: 'FEEDBACK_CLASS_INVALID',
        error: `Unknown feedback classification: ${String(body.classification)}`,
      });
    }
    const requestHash = sha256Canonical({
      text: body.text.trim(),
      classification,
      targetContractHash: optionalString(body.targetContractHash),
      targetPlanHash: optionalString(body.targetPlanHash),
      targetCommit: optionalString(body.targetCommit),
    });
    const replay = feedback.getByIdempotencyKey(taskId, idempotencyKey);
    if (replay !== undefined) {
      if (replay.requestHash !== requestHash) {
        return reply.code(409).send({
          code: 'IDEMPOTENCY_KEY_REUSED',
          error: 'The idempotency key was already used for different feedback.',
        });
      }
      return reply.code(200).send({ feedback: replay, replayed: true });
    }

    const timestamp = new Date().toISOString();
    const item = feedback.create({
      id: `feedback_${randomUUID()}`,
      taskId,
      sourceActorId: actorId(request.headers['x-roleflock-actor-id']),
      text: body.text.trim(),
      classification,
      targetContractHash: optionalString(body.targetContractHash),
      targetPlanHash: optionalString(body.targetPlanHash),
      targetCommit: optionalString(body.targetCommit),
      status: 'routed',
      routedRole: feedbackDecisionOwner(classification),
      idempotencyKey,
      requestHash,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    bus.publish('feedback.routed', {
      taskId,
      feedbackId: item.id,
      classification: item.classification,
      routedRole: item.routedRole,
    });
    return reply.code(201).send({ feedback: item, replayed: false });
  });

  app.get('/api/tasks/:taskId/feedback', async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    if (tasks.get(taskId) === undefined) {
      return reply.code(404).send({ code: 'TASK_NOT_FOUND', error: 'Task not found' });
    }
    return { feedback: feedback.list(taskId) };
  });
}

function parseFeedbackClass(value: unknown): FeedbackClass | undefined {
  return typeof value === 'string' &&
    [
      'requirement_change',
      'implementation_preference',
      'implementation_defect',
      'plan_gap',
      'verification_gap',
      'policy_exception',
      'interactive_cosmetic_change',
      'unknown',
    ].includes(value)
    ? (value as FeedbackClass)
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function actorId(value: string | string[] | undefined): string {
  return typeof value === 'string' && value.trim() ? value.trim() : 'local-user';
}
