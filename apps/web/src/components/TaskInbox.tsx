import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatTaskState } from '../lib/format.js';
import { useData } from '../lib/client.js';
import type { Approval, Project, Task } from '../types.js';

const NEEDS_YOU = new Set(['awaiting_confirmation', 'awaiting_acceptance', 'failed']);
const WORKING = new Set(['running', 'paused', 'ready', 'stopping']);

function InboxTask({
  task,
  project,
  selected,
  approvalCount,
}: {
  task: Task;
  project?: Project;
  selected: boolean;
  approvalCount: number;
}) {
  const needsYou = NEEDS_YOU.has(task.state) || approvalCount > 0;
  return (
    <Link className={`inbox-task${selected ? ' selected' : ''}`} to={`/tasks/${task.id}`}>
      <span className={`inbox-state-dot state-${needsYou ? 'attention' : task.state}`} />
      <span className="inbox-task-copy">
        <small>{project?.name ?? 'Local project'}</small>
        <strong>{task.title}</strong>
        <span>
          {needsYou ? 'Action required' : formatTaskState(task.state)}
          {approvalCount ? ` · ${approvalCount} approval${approvalCount === 1 ? '' : 's'}` : ''}
        </span>
      </span>
    </Link>
  );
}

export function TaskInbox() {
  const { id: selectedId } = useParams();
  const [query, setQuery] = useState('');
  const { data: tasks = [] } = useData<Task[]>(['tasks'], '/api/tasks');
  const { data: projects = [] } = useData<Project[]>(['projects'], '/api/projects');
  const { data: approvals = [] } = useData<Approval[]>(['approvals'], '/api/approvals');
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const approvalsByTask = useMemo(() => {
    const counts = new Map<string, number>();
    for (const approval of approvals) {
      if (approval.taskId) counts.set(approval.taskId, (counts.get(approval.taskId) ?? 0) + 1);
    }
    return counts;
  }, [approvals]);
  const filtered = tasks.filter((task) => {
    const text =
      `${task.title} ${projectsById.get(task.projectId ?? '')?.name ?? ''}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });
  const groups = [
    {
      label: 'Needs you',
      tasks: filtered.filter(
        (task) => NEEDS_YOU.has(task.state) || (approvalsByTask.get(task.id) ?? 0) > 0,
      ),
    },
    {
      label: 'In progress',
      tasks: filtered.filter(
        (task) =>
          WORKING.has(task.state) &&
          !NEEDS_YOU.has(task.state) &&
          (approvalsByTask.get(task.id) ?? 0) === 0,
      ),
    },
    {
      label: 'Completed',
      tasks: filtered.filter((task) => ['accepted', 'rejected', 'cancelled'].includes(task.state)),
    },
  ];

  return (
    <aside className="task-inbox" aria-label="Task inbox">
      <div className="inbox-head">
        <div>
          <span className="eyebrow">Workspace</span>
          <h2>Task inbox</h2>
        </div>
        <Link className="icon-button" to="/tasks/new" aria-label="Create task">
          +
        </Link>
      </div>
      <label className="inbox-search">
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tasks"
          aria-label="Search tasks"
        />
      </label>
      <div className="inbox-groups">
        {groups.map((group) =>
          group.tasks.length ? (
            <section key={group.label} className="inbox-group">
              <h3>
                {group.label} <span>{group.tasks.length}</span>
              </h3>
              {group.tasks.map((task) => (
                <InboxTask
                  key={task.id}
                  task={task}
                  project={projectsById.get(task.projectId ?? '')}
                  selected={selectedId === task.id}
                  approvalCount={approvalsByTask.get(task.id) ?? 0}
                />
              ))}
            </section>
          ) : null,
        )}
        {!filtered.length ? <p className="inbox-empty">No matching tasks.</p> : null}
      </div>
    </aside>
  );
}
