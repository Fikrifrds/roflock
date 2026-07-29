import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { formatTaskState, isTerminalState } from '../lib/format.js';
import { api, useData } from '../lib/client.js';
import type { Approval, Project, Task } from '../types.js';

const NEEDS_YOU = new Set(['awaiting_confirmation', 'awaiting_acceptance', 'failed']);
const WORKING = new Set(['running', 'paused', 'ready', 'stopping']);
const WORKSPACE_KEY = 'roleflock-inbox-project';

function canDeleteTask(state: string) {
  return state === 'ready' || isTerminalState(state);
}

function InboxTask({
  task,
  project,
  selected,
  approvalCount,
  onDeleted,
}: {
  task: Task;
  project?: Project;
  selected: boolean;
  approvalCount: number;
  onDeleted: (taskId: string) => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const needsYou = NEEDS_YOU.has(task.state) || approvalCount > 0;
  const deletable = canDeleteTask(task.state);

  const deleteTask = async (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (
      !window.confirm(
        `Delete “${task.title}”?\n\nThis removes the task from the inbox. Your Git repository is not deleted.`,
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      await api.request(`/api/tasks/${task.id}`, { method: 'DELETE' });
      onDeleted(task.id);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to delete task');
      setDeleting(false);
    }
  };

  return (
    <div className={`inbox-task${selected ? ' selected' : ''}`}>
      <Link className="inbox-task-link" to={`/tasks/${task.id}`}>
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
      {deletable ? (
        <button
          type="button"
          className="inbox-task-delete"
          aria-label={`Delete ${task.title}`}
          title="Delete task"
          disabled={deleting}
          onClick={(event) => void deleteTask(event)}
        >
          {deleting ? '…' : '✕'}
        </button>
      ) : null}
    </div>
  );
}

function readStoredProjectId(): string | null {
  try {
    return localStorage.getItem(WORKSPACE_KEY);
  } catch {
    return null;
  }
}

export function TaskInbox() {
  const { id: selectedId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState<string | null>(() => readStoredProjectId());
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!projectId) return;
    if (projectsById.has(projectId)) return;
    try {
      localStorage.removeItem(WORKSPACE_KEY);
    } catch {
      /* ignore */
    }
  }, [projectId, projectsById]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPickerOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [pickerOpen]);

  const effectiveProjectId = projectId && projectsById.has(projectId) ? projectId : null;
  const activeProject = effectiveProjectId ? projectsById.get(effectiveProjectId) : undefined;
  const pickerLabel = activeProject?.name ?? (projects.length ? 'All projects' : 'No projects');

  const selectProject = (next: string | null) => {
    setProjectId(next);
    setPickerOpen(false);
    try {
      if (next) localStorage.setItem(WORKSPACE_KEY, next);
      else localStorage.removeItem(WORKSPACE_KEY);
    } catch {
      /* ignore */
    }
  };

  const handleDeleted = async (taskId: string) => {
    await qc.invalidateQueries({ queryKey: ['tasks'] });
    await qc.invalidateQueries({ queryKey: ['approvals'] });
    if (selectedId === taskId) navigate('/');
  };

  const filtered = tasks.filter((task) => {
    if (effectiveProjectId && task.projectId !== effectiveProjectId) return false;
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
      <div className="inbox-project" ref={pickerRef}>
        {projects.length === 0 ? (
          <Link className="inbox-project-trigger" to="/projects">
            <span className="inbox-project-icon" aria-hidden="true">
              ◇
            </span>
            <span className="inbox-project-label">Add a project</span>
          </Link>
        ) : (
          <>
            <button
              type="button"
              className="inbox-project-trigger"
              aria-haspopup="listbox"
              aria-expanded={pickerOpen}
              aria-label="Filter by project"
              onClick={() => setPickerOpen((open) => !open)}
            >
              <span className="inbox-project-icon" aria-hidden="true">
                ◇
              </span>
              <span className="inbox-project-label">{pickerLabel}</span>
              <span className="inbox-project-chevron" aria-hidden="true">
                ▾
              </span>
            </button>
            {pickerOpen ? (
              <ul className="inbox-project-menu" role="listbox" aria-label="Projects">
                <li role="option" aria-selected={!projectId}>
                  <button type="button" onClick={() => selectProject(null)}>
                    All projects
                  </button>
                </li>
                {projects.map((project) => (
                  <li key={project.id} role="option" aria-selected={project.id === projectId}>
                    <button type="button" onClick={() => selectProject(project.id)}>
                      {project.name}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
        <Link
          className="inbox-project-add"
          to="/projects"
          aria-label="Manage projects"
          title="Projects"
        >
          +
        </Link>
      </div>
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
                  onDeleted={(taskId) => void handleDeleted(taskId)}
                />
              ))}
            </section>
          ) : null,
        )}
        {!filtered.length ? (
          <p className="inbox-empty">
            {projects.length === 0
              ? 'Add a project to start.'
              : projectId
                ? 'No matching tasks in this project.'
                : 'No matching tasks.'}
          </p>
        ) : null}
      </div>
    </aside>
  );
}
