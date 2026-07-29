import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  AgentEventOrderingError,
  AgentSourceEventConflictError,
  AuditRepository,
  ExternalAgentEventRepository,
  TaskRepository,
  WorktreeRepository,
  type SqliteDb,
} from '@roleflock/database';
import {
  adaptClaudeCodeHook,
  adaptCodexHook,
  ClaudeCodeHookInputSchema,
  CodexHookInputSchema,
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

  app.post('/api/tasks/:taskId/agent-hooks/codex', async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    if (!tasks.get(taskId)) return reply.code(404).send({ code: 'TASK_NOT_FOUND' });
    try {
      const headers = request.headers;
      const actorId = requiredHeader(headers['x-roleflock-actor-id'], 'x-roleflock-actor-id');
      const installationId = requiredHeader(
        headers['x-roleflock-installation-id'],
        'x-roleflock-installation-id',
      );
      const declaredRole =
        optionalHeader(headers['x-roleflock-declared-role']) ?? 'executor';
      const input = CodexHookInputSchema.parse(request.body);
      const prior = events
        .listSessionsByTask(taskId)
        .find(
          (session) =>
            session.agentFamily === 'codex' &&
            session.nativeSessionId === input.session_id &&
            session.installationId === installationId,
        );
      const worktree = new WorktreeRepository(db).getByTask(taskId);
      if (!worktree) throw new Error(`Task worktree is unavailable: ${taskId}`);
      const timestamp = new Date().toISOString();
      const event = adaptCodexHook(input, {
        binding: currentAgentEventBinding(db, taskId, actorId),
        workspacePath: worktree.path,
        declaredRole,
        sequence: prior ? prior.lastSequence + 1 : 0,
        previousEventHash: prior?.lastEventHash,
        occurredAt: timestamp,
        receivedAt: timestamp,
        installationId,
      });
      assertAgentEventCorrelation(db, taskId, event);
      const result = events.ingest(event);
      audit.append({
        id: randomUUID(),
        actor: actorId,
        action: 'external_agent.codex_hook_ingested',
        targetType: 'task',
        targetId: taskId,
        details: {
          hookEventName: input.hook_event_name,
          nativeSessionId: input.session_id,
          eventHash: event.eventHash,
          status: result.status,
        },
        createdAt: timestamp,
      });
      return result;
    } catch (error) {
      return ingestError(reply, error);
    }
  });

  app.post('/api/tasks/:taskId/agent-hooks/claude-code', async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    if (!tasks.get(taskId)) return reply.code(404).send({ code: 'TASK_NOT_FOUND' });
    try {
      const actorId = requiredHeader(
        request.headers['x-roleflock-actor-id'],
        'x-roleflock-actor-id',
      );
      const installationId = requiredHeader(
        request.headers['x-roleflock-installation-id'],
        'x-roleflock-installation-id',
      );
      const input = ClaudeCodeHookInputSchema.parse(request.body);
      const prior = events
        .listSessionsByTask(taskId)
        .find(
          (session) =>
            session.agentFamily === 'claude_code' &&
            session.nativeSessionId === input.session_id &&
            session.installationId === installationId,
        );
      const worktree = new WorktreeRepository(db).getByTask(taskId);
      if (!worktree) throw new Error(`Task worktree is unavailable: ${taskId}`);
      const timestamp = new Date().toISOString();
      const event = adaptClaudeCodeHook(input, {
        binding: currentAgentEventBinding(db, taskId, actorId),
        workspacePath: worktree.path,
        declaredRole:
          optionalHeader(request.headers['x-roleflock-declared-role']) ?? 'executor',
        sequence: prior ? prior.lastSequence + 1 : 0,
        previousEventHash: prior?.lastEventHash,
        occurredAt: timestamp,
        receivedAt: timestamp,
        installationId,
        modelId: optionalHeader(request.headers['x-roleflock-model-id']),
      });
      assertAgentEventCorrelation(db, taskId, event);
      const result = events.ingest(event);
      audit.append({
        id: randomUUID(),
        actor: actorId,
        action: 'external_agent.claude_code_hook_ingested',
        targetType: 'task',
        targetId: taskId,
        details: {
          hookEventName: input.hook_event_name,
          nativeSessionId: input.session_id,
          eventHash: event.eventHash,
          status: result.status,
        },
        createdAt: timestamp,
      });
      return result;
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

function requiredHeader(value: string | string[] | undefined, name: string): string {
  const resolved = optionalHeader(value);
  if (!resolved) throw new Error(`${name} header is required`);
  return resolved;
}

function optionalHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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
