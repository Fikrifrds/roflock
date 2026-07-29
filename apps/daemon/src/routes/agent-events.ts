import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  AgentEventOrderingError,
  AgentSourceEventConflictError,
  AuditRepository,
  ExternalAgentEventRepository,
  TaskRepository,
  type SqliteDb,
} from '@roleflock/database';
import {
  NormalizedAgentEventSchema,
  parseAgentEventJsonl,
  type NormalizedAgentEvent,
} from '@roleflock/agent-events';
import {
  AgentEventCorrelationError,
  assertAgentEventCorrelation,
  currentAgentEventBinding,
} from '../services/agent-event-correlation.js';

export function registerAgentEventRoutes(app: FastifyInstance, db: SqliteDb): void {
  if (!app.hasContentTypeParser('application/x-ndjson')) {
    app.addContentTypeParser(
      'application/x-ndjson',
      { parseAs: 'string' },
      (_request, body, done) => done(null, body),
    );
  }
  const tasks = new TaskRepository(db);
  const events = new ExternalAgentEventRepository(db);
  const audit = new AuditRepository(db);

  app.get('/api/tasks/:taskId/agent-events/binding', async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    if (!tasks.get(taskId)) return reply.code(404).send({ code: 'TASK_NOT_FOUND' });
    try {
      const binding = currentAgentEventBinding(db, taskId, 'caller-stable-actor-id');
      return {
        ...binding,
        actorId: undefined,
        actorIdRequirement: 'Supply a stable external actor identity for this agent installation.',
      };
    } catch (error) {
      return reply.code(409).send({
        code: 'AGENT_EVENT_BINDING_NOT_READY',
        error: error instanceof Error ? error.message : 'Agent event binding is not ready',
      });
    }
  });

  app.post('/api/tasks/:taskId/agent-events', async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    if (!tasks.get(taskId)) return reply.code(404).send({ code: 'TASK_NOT_FOUND' });
    try {
      const batch = parseBatch(request.body);
      for (const event of batch) assertAgentEventCorrelation(db, taskId, event);
      const results = events.ingestBatch(batch);
      const accepted = results.filter((result) => result.status === 'accepted').length;
      const replayed = results.length - accepted;
      audit.append({
        id: randomUUID(),
        actor: batch[0]!.binding.actorId,
        action: 'external_agent.events.ingested',
        targetType: 'task',
        targetId: taskId,
        details: {
          accepted,
          replayed,
          sessionIds: [...new Set(results.map((result) => result.session.id))],
          eventHashes: results.map((result) => result.event.eventHash),
        },
        createdAt: new Date().toISOString(),
      });
      return { accepted, replayed, results };
    } catch (error) {
      return ingestError(reply, error);
    }
  });

  app.get('/api/tasks/:taskId/agent-sessions', async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    if (!tasks.get(taskId)) return reply.code(404).send({ code: 'TASK_NOT_FOUND' });
    return events.listSessionsByTask(taskId);
  });

  app.get('/api/agent-sessions/:sessionId/events', async (request, reply) => {
    const sessionId = (request.params as { sessionId: string }).sessionId;
    const session = events.getSession(sessionId);
    if (!session) return reply.code(404).send({ code: 'AGENT_SESSION_NOT_FOUND' });
    return events.listEvents(sessionId);
  });
}

function parseBatch(body: unknown): NormalizedAgentEvent[] {
  if (typeof body === 'string') return parseAgentEventJsonl(body);
  const raw = Array.isArray(body) ? body : (body as { events?: unknown } | undefined)?.events;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('A non-empty events array or application/x-ndjson body is required');
  }
  if (raw.length > 10_000) throw new Error('Agent event batch exceeds 10000 events');
  return raw.map((event) => NormalizedAgentEventSchema.parse(event));
}

function ingestError(reply: FastifyReply, error: unknown) {
  if (error instanceof AgentEventCorrelationError) {
    return reply.code(409).send({ code: error.code, error: error.message });
  }
  if (error instanceof AgentEventOrderingError) {
    return reply
      .code(409)
      .send({ code: 'AGENT_EVENT_ORDERING_INVALID', violations: error.violations });
  }
  if (error instanceof AgentSourceEventConflictError) {
    return reply.code(409).send({ code: 'AGENT_SOURCE_EVENT_CONFLICT', error: error.message });
  }
  return reply.code(400).send({
    code: 'AGENT_EVENT_BATCH_INVALID',
    error: error instanceof Error ? error.message : 'External agent event batch is invalid',
  });
}
