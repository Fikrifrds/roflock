import { describe, expect, it } from 'vitest';
import { adaptCodexHook, type CodexAdapterContext } from './codex.js';

describe('Codex hook adapter', () => {
  it('binds an official SessionStart payload to the pinned task and worktree', () => {
    const event = adaptCodexHook(
      {
        session_id: 'thr_123',
        transcript_path: '/tmp/transcript.jsonl',
        cwd: '/repo/.roleflock/worktrees/task_1',
        hook_event_name: 'SessionStart',
        model: 'gpt-5.6-sol',
        permission_mode: 'default',
        source: 'startup',
      },
      context(),
    );
    expect(event.source).toMatchObject({
      agentFamily: 'codex',
      nativeSessionId: 'thr_123',
      sourceEventId: 'SessionStart:startup',
    });
    expect(event.binding.taskId).toBe('task_1');
    expect(event.binding.planHash).toBe('2'.repeat(64));
    expect(event.binding.worktreeId).toBe('worktree_1');
    expect(event.payload).toEqual({
      type: 'session.started',
      interactionMode: 'interactive',
      declaredRole: 'executor',
    });
  });

  it('maps tool lifecycle payloads without retaining sensitive arguments', () => {
    const first = adaptCodexHook(
      {
        session_id: 'thr_123',
        cwd: '/repo/.roleflock/worktrees/task_1',
        hook_event_name: 'SessionStart',
        model: 'gpt-5.6-sol',
        source: 'startup',
      },
      context(),
    );
    const event = adaptCodexHook(
      {
        session_id: 'thr_123',
        cwd: '/repo/.roleflock/worktrees/task_1',
        hook_event_name: 'PreToolUse',
        model: 'gpt-5.6-sol',
        permission_mode: 'default',
        turn_id: 'turn_1',
        tool_name: 'Bash',
        tool_use_id: 'call_1',
        tool_input: { command: 'deploy --token super-secret' },
      },
      { ...context(), sequence: 1, previousEventHash: first.eventHash },
    );
    expect(event.payload).toMatchObject({
      type: 'tool.requested',
      tool: { callId: 'call_1', toolName: 'Bash', operation: 'command' },
    });
    expect(JSON.stringify(event)).not.toContain('super-secret');
  });

  it('rejects a session running outside the pinned worktree', () => {
    expect(() =>
      adaptCodexHook(
        {
          session_id: 'thr_123',
          cwd: '/repo',
          hook_event_name: 'SessionStart',
          model: 'gpt-5.6-sol',
          source: 'startup',
        },
        context(),
      ),
    ).toThrow(/does not match pinned worktree/);
  });
});

function context(): CodexAdapterContext {
  return {
    binding: {
      taskId: 'task_1',
      contractHash: '1'.repeat(64),
      planHash: '2'.repeat(64),
      worktreeId: 'worktree_1',
      worktreePathHash: '3'.repeat(64),
      actorId: 'actor_1',
      baseCommit: '4'.repeat(40),
    },
    workspacePath: '/repo/.roleflock/worktrees/task_1',
    declaredRole: 'executor',
    sequence: 0,
    occurredAt: '2026-07-28T12:00:00.000Z',
    receivedAt: '2026-07-28T12:00:00.100Z',
    installationId: 'codex_installation_1',
  };
}
