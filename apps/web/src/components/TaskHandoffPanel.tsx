import { useState } from 'react';
import { Section } from './primitives.js';
import { api, useData } from '../lib/client.js';
import type { Task, TaskHandoff } from '../types.js';

export function TaskHandoffPanel({ task }: { task: Task }) {
  const query = useData<TaskHandoff>(['task-handoff', task.id], `/api/tasks/${task.id}/handoff`);
  const handoff = query.data?.manifest !== undefined ? query.data : undefined;
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  if (handoff === undefined) return null;

  const copy = async (label: string, command: string) => {
    setError('');
    try {
      if (!navigator.clipboard) throw new Error('Clipboard access is unavailable');
      await navigator.clipboard.writeText(command);
      setNotice(`${label} command copied`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to copy handoff command');
    }
  };

  const openFolder = async () => {
    setError('');
    try {
      await api.request(`/api/tasks/${task.id}/handoff/open-folder`, { method: 'POST' });
      setNotice('Task worktree opened');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to open task worktree');
    }
  };

  return (
    <Section
      title="Agent handoff"
      description="Continue in your preferred coding tool without dropping RoleFlock's task, contract, plan, branch, or workspace identity."
      className="task-handoff-panel"
    >
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="hint" role="status">
          {notice}
        </p>
      ) : null}
      <div className="handoff-identity">
        <div>
          <span className="eyebrow">BRANCH</span>
          <code>{handoff.manifest.workspace.branchName}</code>
        </div>
        <div>
          <span className="eyebrow">CONTRACT</span>
          <code>{shortHash(handoff.manifest.authority.contractHash)}</code>
        </div>
        <div>
          <span className="eyebrow">APPROVED PLAN</span>
          <code>{shortHash(handoff.manifest.authority.planHash)}</code>
        </div>
        <div>
          <span className="eyebrow">HANDOFF</span>
          <code>{shortHash(handoff.manifest.hash)}</code>
        </div>
      </div>
      <div className="handoff-actions">
        {handoff.commands.map((command) =>
          command.id === 'folder' ? (
            <button
              key={command.id}
              type="button"
              className="quiet"
              onClick={() => void openFolder()}
            >
              {command.label}
            </button>
          ) : (
            <button
              key={command.id}
              type="button"
              className="quiet"
              onClick={() => void copy(command.label, command.command)}
            >
              {command.label}
            </button>
          ),
        )}
      </div>
      <details className="handoff-command-details">
        <summary>Inspect pinned commands</summary>
        {handoff.commands
          .filter(({ id }) => id !== 'folder')
          .map((command) => (
            <div key={command.id}>
              <strong>{command.label}</strong>
              <code>{command.command}</code>
            </div>
          ))}
      </details>
    </Section>
  );
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}
