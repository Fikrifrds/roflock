import { describe, expect, it } from 'vitest';
import { calculateTelemetryAssurance } from './assurance.js';
import { sealAgentEvent, type AgentEventPayload, type UnsealedAgentEvent } from './index.js';

describe('external handoff assurance gaps', () => {
  it('never upgrades missing telemetry into assurance', () => {
    expect(calculateTelemetryAssurance([])).toMatchObject({
      level: 'unobserved',
      gaps: [{ code: 'NO_TELEMETRY', severity: 'blocking' }],
      reentry: { required: true, owner: 'planner', action: 'review_assurance_gap' },
    });
  });

  it('makes partial lifecycle, file, and command coverage explicit', () => {
    const started = event(0, {
      type: 'session.started',
      interactionMode: 'interactive',
      declaredRole: 'executor',
    });
    const requested = event(
      1,
      {
        type: 'tool.requested',
        tool: {
          callId: 'tool_1',
          toolName: 'Edit',
          operation: 'Edit',
          argumentsDigest: '5'.repeat(64),
        },
      },
      started.eventHash,
    );
    const report = calculateTelemetryAssurance([started, requested]);
    expect(report.level).toBe('partial');
    expect(report.gaps.map((gap) => gap.code)).toEqual([
      'SESSION_NOT_TERMINAL',
      'UNMATCHED_TOOL_REQUEST',
      'FILE_TELEMETRY_MISSING',
      'COMMAND_TELEMETRY_MISSING',
    ]);
  });
});

function event(sequence: number, payload: AgentEventPayload, previousEventHash?: string) {
  return sealAgentEvent({
    schemaVersion: 'agent-event-1.0.0',
    eventId: `event_${sequence}`,
    source: {
      agentFamily: 'codex',
      adapterId: 'test',
      adapterVersion: '1',
      nativeSessionId: 'session_1',
      sourceEventId: `source_${sequence}`,
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
  } satisfies UnsealedAgentEvent);
}
