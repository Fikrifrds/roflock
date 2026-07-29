import { describe, expect, it } from 'vitest';
import { adaptCursorStream, type CursorAdapterContext } from './cursor.js';

describe('Cursor stream-json adapter', () => {
  it('maps init, tool lifecycle, and result events to one pinned hash chain', () => {
    const events = adaptCursorStream(
      [
        {
          type: 'system',
          subtype: 'init',
          cwd: '/worktree/task_1',
          session_id: 'cursor_session_1',
          model: 'Claude 4 Sonnet',
        },
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'working' }] },
          session_id: 'cursor_session_1',
        },
        {
          type: 'tool_call',
          subtype: 'started',
          call_id: 'call_1',
          tool_call: { writeToolCall: { args: { path: 'secret.ts', fileText: 'secret' } } },
          session_id: 'cursor_session_1',
        },
        {
          type: 'tool_call',
          subtype: 'completed',
          call_id: 'call_1',
          tool_call: { writeToolCall: { result: { success: { path: 'secret.ts' } } } },
          session_id: 'cursor_session_1',
        },
        {
          type: 'result',
          subtype: 'success',
          result: 'done',
          duration_ms: 25,
          session_id: 'cursor_session_1',
          request_id: 'request_1',
        },
      ],
      context(),
    );
    expect(events.map((event) => event.payload.type)).toEqual([
      'session.started',
      'tool.requested',
      'tool.completed',
      'session.ended',
    ]);
    expect(events[1]!.previousEventHash).toBe(events[0]!.eventHash);
    expect(events[0]!.binding.worktreeId).toBe('worktree_1');
    expect(JSON.stringify(events)).not.toContain('fileText');
  });

  it('rejects mixed sessions and another workspace', () => {
    expect(() =>
      adaptCursorStream(
        [
          {
            type: 'system',
            subtype: 'init',
            cwd: '/other',
            session_id: 'cursor_session_1',
          },
        ],
        context(),
      ),
    ).toThrow(/does not match pinned worktree/);
  });
});

function context(): CursorAdapterContext {
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
    installationId: 'cursor_installation_1',
    receivedAt: '2026-07-28T12:00:00.000Z',
  };
}
