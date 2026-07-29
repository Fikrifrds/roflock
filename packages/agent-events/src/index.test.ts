import { describe, expect, it } from 'vitest';
import {
  NormalizedAgentEventSchema,
  sealAgentEvent,
  validateAgentEventOrdering,
  verifyAgentEventHash,
  type UnsealedAgentEvent,
} from './index.js';

describe('normalized external agent event v1', () => {
  it('freezes source identity, task authority binding, and canonical hashes', () => {
    const started = sealAgentEvent(
      event(0, {
        type: 'session.started',
        interactionMode: 'interactive',
        declaredRole: 'executor',
      }),
    );
    const write = sealAgentEvent(
      event(
        1,
        {
          type: 'file.observed',
          operation: 'modified',
          path: 'src/checkout.ts',
          beforeDigest: '3'.repeat(64),
          afterDigest: '4'.repeat(64),
          planStepId: 'step_1',
          bytesChanged: 42,
        },
        started.eventHash,
      ),
    );
    expect(started.eventHash).toBe(
      '3591dd129e2fc039a817a146936aa99bf2698121e0321c9a1834e8c50231e196',
    );
    expect(verifyAgentEventHash(write)).toBe(true);
    expect(validateAgentEventOrdering(started, write)).toEqual({ valid: true, violations: [] });
  });

  it('rejects identity changes, cross-task binding, gaps, and broken hash chains', () => {
    const started = sealAgentEvent(
      event(0, { type: 'session.started', interactionMode: 'headless', declaredRole: 'executor' }),
    );
    const raw = event(
      2,
      {
        type: 'command.started',
        commandId: 'command_1',
        argv: ['npm', 'test'],
        argvDigest: '7'.repeat(64),
        redactedArgumentIndexes: [],
        cwdRelative: '.',
        environmentKeys: ['CI'],
        planStepId: 'step_1',
      },
      '9'.repeat(64),
    );
    raw.source.nativeSessionId = 'stolen_session';
    raw.binding.taskId = 'another_task';
    const current = sealAgentEvent(raw);
    expect(
      validateAgentEventOrdering(started, current).violations.map((item) => item.code),
    ).toEqual([
      'SOURCE_IDENTITY_CHANGED',
      'BINDING_CHANGED',
      'SEQUENCE_GAP',
      'PREVIOUS_HASH_MISMATCH',
    ]);
  });

  it('keeps invalid or incomplete event shapes out of the evidence stream', () => {
    expect(() =>
      NormalizedAgentEventSchema.parse({
        ...sealAgentEvent(
          event(0, { type: 'session.started', interactionMode: 'ide', declaredRole: 'planner' }),
        ),
        sequence: 1,
        previousEventHash: undefined,
      }),
    ).toThrow(/previousEventHash/);
    expect(() =>
      sealAgentEvent(
        event(0, {
          type: 'file.observed',
          operation: 'modified',
          path: '../outside.ts',
          afterDigest: '4'.repeat(64),
        }),
      ),
    ).toThrow();
  });

  it('rejects tampering and events after terminal completion', () => {
    const ended = sealAgentEvent(
      event(0, {
        type: 'session.started',
        interactionMode: 'interactive',
        declaredRole: 'executor',
      }),
    );
    const completion = sealAgentEvent(
      event(
        1,
        {
          type: 'agent.completed',
          status: 'completed',
          resultCommit: 'a'.repeat(40),
          summaryDigest: 'b'.repeat(64),
          changedPaths: ['src/checkout.ts'],
          reportedPlanStepIds: ['step_1'],
        },
        ended.eventHash,
      ),
    );
    const after = sealAgentEvent(
      event(
        2,
        {
          type: 'session.ended',
          outcome: 'completed',
          summaryDigest: 'b'.repeat(64),
        },
        completion.eventHash,
      ),
    );
    expect(validateAgentEventOrdering(completion, after).violations).toContainEqual({
      code: 'EVENT_AFTER_TERMINAL',
      reason: 'No event may follow terminal payload agent.completed',
    });
    const tampered = structuredClone(completion);
    (tampered.payload as { status: string }).status = 'failed';
    expect(verifyAgentEventHash(tampered)).toBe(false);
  });
});

function event(
  sequence: number,
  payload: UnsealedAgentEvent['payload'],
  previousEventHash?: string,
): UnsealedAgentEvent {
  return {
    schemaVersion: 'agent-event-1.0.0',
    eventId: `event_${sequence}`,
    source: {
      agentFamily: 'codex',
      adapterId: 'roleflock.codex-hook',
      adapterVersion: '1.0.0',
      nativeSessionId: 'codex_session_1',
      sourceEventId: `native_${sequence}`,
      providerId: 'openai',
      modelId: 'gpt-5.6-sol',
      invocationId: 'invocation_1',
      installationId: 'installation_1',
    },
    binding: {
      taskId: 'task_1',
      contractHash: '1'.repeat(64),
      planHash: '2'.repeat(64),
      worktreeId: 'worktree_1',
      worktreePathHash: '5'.repeat(64),
      actorId: 'external_agent_1',
      baseCommit: '6'.repeat(40),
    },
    sequence,
    ...(previousEventHash ? { previousEventHash } : {}),
    occurredAt: `2026-07-28T12:00:0${sequence}.000Z`,
    receivedAt: `2026-07-28T12:00:0${sequence}.100Z`,
    payload,
  };
}
