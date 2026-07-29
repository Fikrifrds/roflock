import { describe, expect, it } from 'vitest';
import { sealAgentEvent, type UnsealedAgentEvent } from './index.js';
import { parseAgentEventJsonl } from './jsonl.js';

describe('generic agent event JSONL', () => {
  it('parses newline-delimited normalized events without changing identity', () => {
    const event = sealAgentEvent(started());
    expect(parseAgentEventJsonl(`${JSON.stringify(event)}\n\n`)).toEqual([event]);
  });

  it('reports the exact invalid line and enforces batch limits', () => {
    const event = sealAgentEvent(started());
    expect(() => parseAgentEventJsonl(`${JSON.stringify(event)}\n{"bad":true}`)).toThrow(/line 2/);
    expect(() =>
      parseAgentEventJsonl(JSON.stringify(event), { maximumBytes: 2, maximumEvents: 1 }),
    ).toThrow(/exceeds 2 bytes/);
  });
});

function started(): UnsealedAgentEvent {
  return {
    schemaVersion: 'agent-event-1.0.0',
    eventId: 'event_0',
    source: {
      agentFamily: 'generic',
      adapterId: 'generic-jsonl',
      adapterVersion: '1.0.0',
      nativeSessionId: 'session_1',
      sourceEventId: 'source_0',
    },
    binding: {
      taskId: 'task_1',
      contractHash: '1'.repeat(64),
      planHash: '2'.repeat(64),
      worktreeId: 'worktree_1',
      worktreePathHash: '3'.repeat(64),
      actorId: 'external_agent_1',
      baseCommit: '4'.repeat(40),
    },
    sequence: 0,
    occurredAt: '2026-07-28T12:00:00.000Z',
    receivedAt: '2026-07-28T12:00:00.100Z',
    payload: {
      type: 'session.started',
      interactionMode: 'headless',
      declaredRole: 'executor',
    },
  };
}
