import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TaskHandoffPanel } from '../src/components/TaskHandoffPanel.js';
import type { Task, TaskHandoff } from '../src/types.js';
import { renderApp, stubApi } from './render.js';

const task: Task = {
  id: 'task_1',
  projectId: 'project_1',
  title: 'Pinned handoff',
  type: 'bug_fix',
  state: 'running',
  risk: 'high',
  brief: 'Preserve authority identity.',
  maxAttempts: 3,
  workflowGraphVersionId: 'bug_fix@3',
};

const handoff: TaskHandoff = {
  manifest: {
    schemaVersion: 1,
    task: { id: task.id, title: task.title, projectId: task.projectId! },
    authority: {
      contractId: 'contract_1',
      contractHash: 'a'.repeat(64),
      planId: 'plan_1',
      planHash: 'b'.repeat(64),
      planVersion: 1,
    },
    workspace: {
      path: '/tmp/roleflock/task_1',
      branchName: 'roleflock/task_1',
      baseCommit: 'c'.repeat(40),
    },
    issuedAt: '2026-07-28T10:00:00.000Z',
    hashAlgorithm: 'sha256',
    hash: 'd'.repeat(64),
  },
  commands: [
    {
      id: 'codex',
      label: 'Open in Codex',
      command: "cd '/tmp/roleflock/task_1' && ROLEFLOCK_TASK_ID='task_1' codex",
    },
    {
      id: 'claude',
      label: 'Open in Claude Code',
      command: "cd '/tmp/roleflock/task_1' && ROLEFLOCK_TASK_ID='task_1' claude",
    },
    {
      id: 'cursor',
      label: 'Open in Cursor',
      command: "cd '/tmp/roleflock/task_1' && ROLEFLOCK_TASK_ID='task_1' cursor-agent",
    },
    {
      id: 'folder',
      label: 'Open folder',
      command: "cd '/tmp/roleflock/task_1'",
    },
  ],
};

describe('TaskHandoffPanel', () => {
  it('copies pinned agent commands and opens only the server-provided worktree', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const fetchMock = stubApi({
      '/api/tasks/task_1/handoff/open-folder': { opened: true },
      '/api/tasks/task_1/handoff': handoff,
    });

    renderApp(<TaskHandoffPanel task={task} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Open in Codex' }));
    expect(writeText).toHaveBeenCalledWith(handoff.commands[0]!.command);
    expect(await screen.findByText('Open in Codex command copied')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Open folder' }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([path, init]) =>
            path === '/api/tasks/task_1/handoff/open-folder' &&
            (init as RequestInit).method === 'POST',
        ),
      ).toBe(true);
    });
  });
});
