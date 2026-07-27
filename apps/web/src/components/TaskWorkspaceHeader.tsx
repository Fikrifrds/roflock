import { Link } from 'react-router-dom';
import { formatTaskState, taskStateTone } from '../lib/format.js';
import type { Task } from '../types.js';
import { StatusPill } from './primitives.js';

export type TaskWorkspaceView = 'workflow' | 'changes' | 'evidence';

export function TaskWorkspaceHeader({
  task,
  activeView,
}: {
  task: Task;
  activeView: TaskWorkspaceView;
}) {
  const taskType = task.type?.replaceAll('_', ' ') ?? 'task';
  const taskRisk = task.risk ?? 'medium';

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
    </div>
  );
}
