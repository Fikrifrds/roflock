import { Link } from 'react-router-dom';
import { formatTaskState, isTerminalState, taskStateTone } from '../lib/format.js';
import type { Task } from '../types.js';
import { StatusPill } from './primitives.js';

export type TaskWorkspaceView = 'workflow' | 'changes' | 'evidence';

function canDeleteTask(state: string) {
  return state === 'ready' || isTerminalState(state);
}

export function TaskWorkspaceHeader({
  task,
  activeView,
  onDelete,
  deleting = false,
}: {
  task: Task;
  activeView: TaskWorkspaceView;
  onDelete?: () => void;
  deleting?: boolean;
}) {
  const taskType = task.type?.replaceAll('_', ' ') ?? 'task';
  const taskRisk = task.risk ?? 'medium';
  const deletable = canDeleteTask(task.state);
  const deleteHint = deletable
    ? 'Delete this task from the inbox'
    : 'Stop or finish the task before deleting';

  return (
    <div className="task-workspace-head">
      <div>
        <div className="task-workspace-kicker">
          <p className="eyebrow">Governed task</p>
          <StatusPill tone={taskStateTone(task.state)}>{formatTaskState(task.state)}</StatusPill>
          <span>
            {taskType} · {taskRisk} risk
          </span>
        </div>
        <h1>{task.title ?? 'Loading task…'}</h1>
        {task.brief ? <p className="task-workspace-brief">{task.brief}</p> : null}
      </div>
      <div className="task-workspace-actions">
        <div className="workspace-tabs" role="tablist" aria-label="Task workspace">
          <Link
            role="tab"
            aria-selected={activeView === 'workflow'}
            className={`workspace-tab-link${activeView === 'workflow' ? ' active' : ''}`}
            to={`/tasks/${task.id}`}
          >
            Workflow
          </Link>
          <Link
            role="tab"
            aria-selected={activeView === 'changes'}
            className={`workspace-tab-link${activeView === 'changes' ? ' active' : ''}`}
            to={`/tasks/${task.id}?view=changes`}
          >
            Changes &amp; Git
          </Link>
          <Link
            role="tab"
            aria-selected={activeView === 'evidence'}
            className={`workspace-tab-link${activeView === 'evidence' ? ' active' : ''}`}
            to={`/tasks/${task.id}/evidence`}
          >
            Evidence
          </Link>
        </div>
        {onDelete ? (
          <button
            type="button"
            className="danger task-delete-button"
            disabled={deleting || !deletable}
            title={deleteHint}
            aria-label={deleteHint}
            onClick={onDelete}
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
