import { describe, expect, it } from 'vitest';
import { adaptClaudeCodeHook, type ClaudeCodeAdapterContext } from './claude-code.js';

describe('Claude Code hook adapter', () => {
  it('maps the native session and tool lifecycle to a pinned task stream', () => {
    const started = adaptClaudeCodeHook(
      {
        session_id: 'claude_session_1',
        transcript_path: '/tmp/claude.jsonl',
        cwd: '/worktree/task_1',
        permission_mode: 'default',
        hook_event_name: 'SessionStart',
        source: 'startup',
      },
      context(),
    );
    const tool = adaptClaudeCodeHook(
      {
        session_id: 'claude_session_1',
        cwd: '/worktree/task_1',
        permission_mode: 'default',
        hook_event_name: 'PreToolUse',
        tool_name: 'Edit',
        tool_use_id: 'tool_1',
        tool_input: { file_path: '/worktree/task_1/src/app.ts', new_string: 'secret' },
      },
      { ...context(), sequence: 1, previousEventHash: started.eventHash },
    );
    expect(started.binding).toEqual(context().binding);
    expect(tool.source).toMatchObject({
      agentFamily: 'claude_code',
      nativeSessionId: 'claude_session_1',
    });
    expect(tool.payload).toMatchObject({
      type: 'tool.requested',
      tool: { callId: 'tool_1', toolName: 'Edit' },
    });
    expect(JSON.stringify(tool)).not.toContain('new_string');
  });

  it('rejects telemetry from a different cwd', () => {
    expect(() =>
      adaptClaudeCodeHook(
        {
          session_id: 'claude_session_1',
          cwd: '/other',
          hook_event_name: 'SessionStart',
          source: 'startup',
        },
        context(),
      ),
    ).toThrow(/does not match pinned worktree/);
  });
});

function context(): ClaudeCodeAdapterContext {
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
    workspacePath: '/worktree/task_1',
    declaredRole: 'executor',
    sequence: 0,
    occurredAt: '2026-07-28T12:00:00.000Z',
    installationId: 'claude_installation_1',
    modelId: 'claude-opus-4-1',
  };
}
