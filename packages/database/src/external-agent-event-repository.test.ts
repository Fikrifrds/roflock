import { afterEach, describe, expect, it } from 'vitest';
import { sealAgentEvent, type UnsealedAgentEvent } from '@roleflock/agent-events';
import { migrate, openDatabase, type SqliteDb } from './client.js';
import {
  AgentEventOrderingError,
  AgentSourceEventConflictError,
  ExternalAgentEventRepository,
} from './repositories/external-agent-event-repository.js';

let db: SqliteDb | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
});

describe('ExternalAgentEventRepository', () => {
  it('accepts an ordered stream and idempotently replays an exact source event', () => {
    db = openDatabase({ path: ':memory:' });
    migrate(db);
    const repository = new ExternalAgentEventRepository(db);
    const first = sealAgentEvent(event(0));
    expect(repository.ingest(first).status).toBe('accepted');
    expect(repository.ingest(first).status).toBe('replayed');
    const second = sealAgentEvent(
      event(1, first.eventHash, {
        type: 'tool.requested',
        tool: {
          callId: 'call_1',
          toolName: 'read_file',
          operation: 'read',
          argumentsDigest: '7'.repeat(64),
        },
      }),
    );
    expect(repository.ingest(second)).toMatchObject({
      status: 'accepted',
      session: { lastSequence: 1, lastEventHash: second.eventHash },
    });
    const session = repository.listSessionsByTask('task_1')[0]!;
    expect(repository.listEvents(session.id)).toEqual([first, second]);
  });

  it('rejects source identity conflicts and rolls back a batch with a sequence gap', () => {
    db = openDatabase({ path: ':memory:' });
    migrate(db);
    const repository = new ExternalAgentEventRepository(db);
    const first = sealAgentEvent(event(0));
    repository.ingest(first);
    const conflict = sealAgentEvent({
      ...event(0),
      payload: {
        type: 'session.started',
        interactionMode: 'ide',
        declaredRole: 'executor',
      },
    });
    expect(() => repository.ingest(conflict)).toThrow(AgentSourceEventConflictError);

    const otherFirst = sealAgentEvent({
      ...event(0),
      eventId: 'other_0',
      source: {
        ...event(0).source,
        nativeSessionId: 'other_session',
        sourceEventId: 'other_source_0',
      },
    });
    const gapBase = event(2, otherFirst.eventHash, {
      type: 'tool.requested',
      tool: {
        callId: 'gap_call',
        toolName: 'read_file',
        operation: 'read',
        argumentsDigest: '8'.repeat(64),
      },
    });
    const gap = sealAgentEvent({
      ...gapBase,
      eventId: 'other_2',
      source: {
        ...gapBase.source,
        nativeSessionId: 'other_session',
        sourceEventId: 'other_source_2',
      },
    });
    expect(() => repository.ingestBatch([otherFirst, gap])).toThrow(AgentEventOrderingError);
    expect(repository.listSessionsByTask('task_1')).toHaveLength(1);
  });
});

function event(
  sequence: number,
  previousEventHash?: string,
  payload: UnsealedAgentEvent['payload'] = {
    type: 'session.started',
    interactionMode: 'headless',
    declaredRole: 'executor',
  },
): UnsealedAgentEvent {
  return {
    schemaVersion: 'agent-event-1.0.0',
    eventId: `event_${sequence}`,
    source: {
      agentFamily: 'generic',
      adapterId: 'generic-http',
      adapterVersion: '1.0.0',
      nativeSessionId: 'session_1',
      sourceEventId: `source_${sequence}`,
      installationId: 'installation_1',
    },
    binding: {
      taskId: 'task_1',
      contractHash: '1'.repeat(64),
      planHash: '2'.repeat(64),
      worktreeId: 'worktree_1',
      worktreePathHash: '3'.repeat(64),
      actorId: 'actor_1',
      baseCommit: '4'.repeat(40),
    },
    sequence,
    ...(previousEventHash ? { previousEventHash } : {}),
    occurredAt: `2026-07-28T12:00:0${sequence}.000Z`,
    receivedAt: `2026-07-28T12:00:0${sequence}.100Z`,
    payload,
  };
}
