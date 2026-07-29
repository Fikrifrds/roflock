import { sha256Canonical } from '@roleflock/contracts';
import {
  NormalizedAgentEventSchema,
  validateAgentEventOrdering,
  type ExternalAgentBinding,
  type NormalizedAgentEvent,
} from '@roleflock/agent-events';
import type { SqliteDb } from '../client.js';

export interface ExternalAgentSession {
  id: string;
  agentFamily: string;
  adapterId: string;
  adapterVersion: string;
  nativeSessionId: string;
  installationId?: string;
  binding: ExternalAgentBinding;
  lastSequence: number;
  lastEventHash: string;
  status: 'active' | 'completed' | 'ended';
  startedAt: string;
  updatedAt: string;
}

export interface AgentEventIngestResult {
  status: 'accepted' | 'replayed';
  session: ExternalAgentSession;
  event: NormalizedAgentEvent;
}

export class AgentSourceEventConflictError extends Error {
  constructor() {
    super('Source event identity was replayed with different normalized content');
    this.name = 'AgentSourceEventConflictError';
  }
}

export class AgentEventOrderingError extends Error {
  constructor(readonly violations: ReturnType<typeof validateAgentEventOrdering>['violations']) {
    super(
      `External agent event ordering failed: ${violations.map((item) => item.code).join(', ')}`,
    );
    this.name = 'AgentEventOrderingError';
  }
}

export class ExternalAgentEventRepository {
  constructor(private readonly db: SqliteDb) {}

  ingestBatch(events: readonly NormalizedAgentEvent[]): AgentEventIngestResult[] {
    return this.db.transaction(() => events.map((event) => this.ingestOne(event)))();
  }

  ingest(input: NormalizedAgentEvent): AgentEventIngestResult {
    return this.db.transaction(() => this.ingestOne(input))();
  }

  private ingestOne(input: NormalizedAgentEvent): AgentEventIngestResult {
    const event = NormalizedAgentEventSchema.parse(input);
    const streamId = sourceStreamId(event);
    const replay = this.findReplay(streamId, event);
    if (replay) return replay;

    const session = this.getSession(streamId);
    const previous = session ? this.getLastEvent(streamId) : undefined;
    const ordering = validateAgentEventOrdering(previous, event);
    if (!ordering.valid) throw new AgentEventOrderingError(ordering.violations);
    if (!session) {
      this.db
        .prepare(
          `INSERT INTO external_agent_sessions (
             id, agent_family, adapter_id, adapter_version, native_session_id, installation_id,
             task_id, contract_hash, plan_hash, worktree_id, worktree_path_hash, actor_id,
             base_commit, binding_json, last_sequence, last_event_hash, status, started_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          streamId,
          event.source.agentFamily,
          event.source.adapterId,
          event.source.adapterVersion,
          event.source.nativeSessionId,
          event.source.installationId ?? null,
          event.binding.taskId,
          event.binding.contractHash,
          event.binding.planHash,
          event.binding.worktreeId,
          event.binding.worktreePathHash,
          event.binding.actorId,
          event.binding.baseCommit,
          JSON.stringify(event.binding),
          event.sequence,
          event.eventHash,
          statusFor(event),
          event.occurredAt,
          event.receivedAt,
        );
    }
    this.db
      .prepare(
        `INSERT INTO external_agent_events (
           event_id, session_id, source_event_id, sequence, event_hash, payload_type,
           event_json, occurred_at, received_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.eventId,
        streamId,
        event.source.sourceEventId,
        event.sequence,
        event.eventHash,
        event.payload.type,
        JSON.stringify(event),
        event.occurredAt,
        event.receivedAt,
        event.receivedAt,
      );
    if (session) {
      this.db
        .prepare(
          `UPDATE external_agent_sessions
           SET adapter_version = ?, last_sequence = ?, last_event_hash = ?, status = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          event.source.adapterVersion,
          event.sequence,
          event.eventHash,
          statusFor(event),
          event.receivedAt,
          streamId,
        );
    }
    return {
      status: 'accepted',
      session: this.getSession(streamId)!,
      event,
    };
  }

  getSession(id: string): ExternalAgentSession | undefined {
    const row = this.db.prepare('SELECT * FROM external_agent_sessions WHERE id = ?').get(id) as
      Record<string, unknown> | undefined;
    return row ? mapSession(row) : undefined;
  }

  listSessionsByTask(taskId: string): ExternalAgentSession[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM external_agent_sessions
           WHERE task_id = ? ORDER BY updated_at DESC, id ASC`,
        )
        .all(taskId) as Array<Record<string, unknown>>
    ).map(mapSession);
  }

  listEvents(sessionId: string): NormalizedAgentEvent[] {
    return (
      this.db
        .prepare(
          `SELECT event_json FROM external_agent_events
           WHERE session_id = ? ORDER BY sequence ASC`,
        )
        .all(sessionId) as Array<{ event_json: string }>
    ).map((row) => NormalizedAgentEventSchema.parse(JSON.parse(row.event_json)));
  }

  private findReplay(
    streamId: string,
    event: NormalizedAgentEvent,
  ): AgentEventIngestResult | undefined {
    const row = this.db
      .prepare(
        `SELECT event_json, event_hash, session_id FROM external_agent_events
         WHERE event_id = ? OR (session_id = ? AND source_event_id = ?)
         LIMIT 1`,
      )
      .get(event.eventId, streamId, event.source.sourceEventId) as
      { event_json: string; event_hash: string; session_id: string } | undefined;
    if (!row) return undefined;
    if (row.event_hash !== event.eventHash) throw new AgentSourceEventConflictError();
    return {
      status: 'replayed',
      session: this.getSession(row.session_id)!,
      event: NormalizedAgentEventSchema.parse(JSON.parse(row.event_json)),
    };
  }

  private getLastEvent(sessionId: string): NormalizedAgentEvent | undefined {
    const row = this.db
      .prepare(
        `SELECT event_json FROM external_agent_events
         WHERE session_id = ? ORDER BY sequence DESC LIMIT 1`,
      )
      .get(sessionId) as { event_json: string } | undefined;
    return row ? NormalizedAgentEventSchema.parse(JSON.parse(row.event_json)) : undefined;
  }
}

export function sourceStreamId(event: Pick<NormalizedAgentEvent, 'source'>): string {
  return `agent_session_${sha256Canonical({
    agentFamily: event.source.agentFamily,
    adapterId: event.source.adapterId,
    nativeSessionId: event.source.nativeSessionId,
    installationId: event.source.installationId ?? null,
  }).slice(0, 40)}`;
}

function statusFor(event: NormalizedAgentEvent): ExternalAgentSession['status'] {
  if (event.payload.type === 'agent.completed') return 'completed';
  if (event.payload.type === 'session.ended') return 'ended';
  return 'active';
}

function mapSession(row: Record<string, unknown>): ExternalAgentSession {
  return {
    id: String(row.id),
    agentFamily: String(row.agent_family),
    adapterId: String(row.adapter_id),
    adapterVersion: String(row.adapter_version),
    nativeSessionId: String(row.native_session_id),
    installationId: row.installation_id ? String(row.installation_id) : undefined,
    binding: JSON.parse(String(row.binding_json)) as ExternalAgentBinding,
    lastSequence: Number(row.last_sequence),
    lastEventHash: String(row.last_event_hash),
    status: row.status as ExternalAgentSession['status'],
    startedAt: String(row.started_at),
    updatedAt: String(row.updated_at),
  };
}
