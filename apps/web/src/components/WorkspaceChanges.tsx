import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, useData } from '../lib/client.js';
import type { Task, TaskWorkspace } from '../types.js';

function statusLabel(index: string, worktree: string) {
  if (index === '?' || worktree === '?') return 'Untracked';
  if (index === 'A' || worktree === 'A') return 'Added';
  if (index === 'D' || worktree === 'D') return 'Deleted';
  if (index === 'R' || worktree === 'R') return 'Renamed';
  return index ? 'Staged' : 'Modified';
}

export function WorkspaceChanges({ task }: { task: Task }) {
  const qc = useQueryClient();
  const { data: workspace } = useData<TaskWorkspace>(
    ['task-workspace', task.id],
    `/api/tasks/${task.id}/workspace`,
  );
  const [selectedPath, setSelectedPath] = useState('');
  const [message, setMessage] = useState(`RoleFlock: ${task.title}`);
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState('');
  const selected = useMemo(
    () =>
      workspace?.available
        ? (workspace.files.find((file) => file.path === selectedPath) ?? workspace.files[0])
        : undefined,
    [selectedPath, workspace],
  );

  const mutate = async (name: string, body: Record<string, unknown>) => {
    setBusy(name);
    setFeedback('');
    try {
      await api.request(`/api/tasks/${task.id}/workspace/${name}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setFeedback(name === 'push' ? 'Branch pushed successfully.' : 'Workspace updated.');
      await qc.invalidateQueries({ queryKey: ['task-workspace', task.id] });
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Action failed');
    } finally {
      setBusy('');
    }
  };

  if (!workspace) return <div className="workspace-empty">Inspecting task workspace…</div>;
  if (!workspace.available)
    return (
      <div className="workspace-empty">
        <span className="workspace-empty-icon">⌘</span>
        <h3>Workspace starts with the task</h3>
        <p>Start this task to create its isolated branch and worktree.</p>
      </div>
    );

  const staged = workspace.files.filter((file) => file.indexStatus && file.indexStatus !== '?');
  const unstaged = workspace.files.filter(
    (file) => file.worktreeStatus || file.indexStatus === '?',
  );
  const canCommit =
    task.state === 'accepted' &&
    staged.length > 0 &&
    unstaged.length === 0 &&
    !workspace.writerLeaseActive;
  const canPush = task.state === 'accepted' && workspace.ahead > 0 && !workspace.writerLeaseActive;

  return (
    <div className="source-workspace">
      <aside className="changes-list" aria-label="Changed files">
        <div className="branch-card">
          <span className="eyebrow">Task branch</span>
          <code>{workspace.branchName}</code>
          <small>
            {workspace.headCommit} · {workspace.ahead} ahead · {workspace.behind} behind
          </small>
        </div>
        {workspace.writerLeaseActive ? (
          <div className="lease-note">
            <span className="live-state-dot" />
            Agent holds the writer lease
          </div>
        ) : null}
        {[
          ['Staged changes', staged],
          ['Changes', unstaged],
        ].map(([label, files]) =>
          (files as typeof workspace.files).length ? (
            <section className="file-group" key={label as string}>
              <h4>
                {label as string} <span>{(files as typeof workspace.files).length}</span>
              </h4>
              {(files as typeof workspace.files).map((file) => (
                <button
                  type="button"
                  key={`${label}-${file.path}`}
                  className={`changed-file${selected?.path === file.path ? ' active' : ''}`}
                  onClick={() => setSelectedPath(file.path)}
                >
                  <span className="file-status">
                    {statusLabel(file.indexStatus, file.worktreeStatus)[0]}
                  </span>
                  <span title={file.path}>{file.path}</span>
                  <small>
                    <i>+{file.added}</i> <b>−{file.removed}</b>
                  </small>
                </button>
              ))}
              <button
                type="button"
                className="text-action"
                disabled={Boolean(busy) || workspace.writerLeaseActive}
                onClick={() =>
                  void mutate('stage', {
                    paths: (files as typeof workspace.files).map((file) => file.path),
                    staged: label !== 'Staged changes',
                  })
                }
              >
                {label === 'Staged changes' ? 'Unstage all' : 'Stage all'}
              </button>
            </section>
          ) : null,
        )}
        {!workspace.files.length ? <p className="inbox-empty">Working tree is clean.</p> : null}
      </aside>

      <section className="diff-workspace">
        <div className="diff-toolbar">
          <div>
            <strong>{selected?.path ?? 'No file selected'}</strong>
            <small>{workspace.files.length} changed files</small>
          </div>
          <div className="diff-stats">
            <span>+{workspace.files.reduce((sum, file) => sum + file.added, 0)}</span>
            <b>−{workspace.files.reduce((sum, file) => sum + file.removed, 0)}</b>
          </div>
        </div>
        {workspace.patch || workspace.stagedPatch ? (
          <pre className="ide-diff" tabIndex={0}>
            {workspace.stagedPatch}
            {workspace.patch}
          </pre>
        ) : (
          <div className="workspace-empty compact">
            <h3>No uncommitted changes</h3>
            <p>The accepted commit is ready to push.</p>
          </div>
        )}
      </section>

      <aside className="git-actions" aria-label="Commit and push">
        <span className="eyebrow">Verified delivery</span>
        <h3>Commit &amp; push</h3>
        <div className={`readiness ${task.state === 'accepted' ? 'ready' : ''}`}>
          <span>{task.state === 'accepted' ? '✓' : '○'}</span>
          <div>
            <strong>{task.state === 'accepted' ? 'Result accepted' : 'Acceptance required'}</strong>
            <small>
              {task.state === 'accepted'
                ? 'The verified result can be committed.'
                : 'Review verification and accept the result first.'}
            </small>
          </div>
        </div>
        <label className="commit-field">
          Commit message
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={4} />
        </label>
        <button
          type="button"
          disabled={!canCommit || !message.trim() || Boolean(busy)}
          onClick={() => void mutate('commit', { message })}
        >
          {busy === 'commit' ? 'Committing…' : 'Commit staged changes'}
        </button>
        <button
          type="button"
          className="push-button"
          disabled={!canPush || Boolean(busy)}
          onClick={() => {
            if (
              window.confirm(
                `Push ${workspace.branchName} to origin?\n\nThis publishes the accepted commit to the remote repository.`,
              )
            )
              void mutate('push', { confirmBranch: workspace.branchName });
          }}
        >
          {busy === 'push' ? 'Pushing…' : `Push ${workspace.branchName}`}
        </button>
        <p className="git-help">
          Push is always explicit. RoleFlock never publishes or merges this branch silently.
        </p>
        {feedback ? (
          <p className="action-feedback" role="status">
            {feedback}
          </p>
        ) : null}
      </aside>
    </div>
  );
}
