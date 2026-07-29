import { Link } from 'react-router-dom';
import { formatTaskState, isTerminalState, taskStateTone } from '../lib/format.js';
import type { Task } from '../types.js';
import { StatusPill } from './primitives.js';

export type TaskWorkspaceView = 'review' | 'authority' | 'workflow' | 'changes' | 'evidence';

/**
 * Ordered by how often someone needs them, not by how the pipeline runs.
 * Review is first because the common visit is "should this ship?", and that
 * question should never require scrolling past setup surfaces to answer.
 */
const TABS: Array<{ view: TaskWorkspaceView; label: string; search: string }> = [
  { view: 'review', label: 'Review', search: '' },
  { view: 'authority', label: 'Authority', search: '?view=authority' },
  { view: 'workflow', label: 'Activity', search: '?view=workflow' },
  { view: 'changes', label: 'Changes & Git', search: '?view=changes' },
];

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
          {TABS.map((tab) => (
            <Link
              key={tab.view}
              role="tab"
              aria-selected={activeView === tab.view}
              className={`workspace-tab-link${activeView === tab.view ? ' active' : ''}`}
              to={`/tasks/${task.id}${tab.search}`}
            >
              {tab.label}
            </Link>
          ))}
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
