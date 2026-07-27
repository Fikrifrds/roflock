import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Shell } from '../components/Shell.js';
import { TaskCard } from '../components/TaskCard.js';
import { Empty, Metric, PageHeader, Section } from '../components/primitives.js';
import { api, useData } from '../lib/client.js';
import { formatTaskState, formatUsage } from '../lib/format.js';
import type { Approval, Task } from '../types.js';

export function Home() {
  const { data: health } = useData<{ ok: boolean; host?: string; port?: number }>(
    ['health'],
    '/api/health',
  );
  const { data: tasks = [] } = useData<Task[]>(['tasks'], '/api/tasks');
  const { data: approvals = [] } = useData<Approval[]>(['approvals'], '/api/approvals');
  const { data: usage } = useQuery({
    queryKey: ['usage-summary'],
    queryFn: async () => {
      try {
        return await api.request<Record<string, unknown>>('/api/usage/summary');
      } catch {
        return undefined;
      }
    },
    refetchInterval: 2000,
  });

  const approvalLabel = `${approvals.length} approval${approvals.length === 1 ? '' : 's'}`;
  const activeTasks = tasks.filter((task) =>
    ['running', 'stopping', 'paused'].includes(task.state),
  );
  const needsYou = tasks.filter(
    (task) =>
      ['awaiting_confirmation', 'awaiting_acceptance', 'failed'].includes(task.state) ||
      approvals.some((approval) => approval.taskId === task.id),
  );
  const verifiedTasks = tasks.filter((task) => task.state === 'accepted');
  const decisionCount = Math.max(needsYou.length, approvals.length);

  return (
    <Shell>
      <PageHeader
        eyebrow="Command center"
        title="Your flock, under control."
        description="Direct concurrent coding work, resolve decisions, and ship only what has been independently verified."
        actions={
          <>
            {approvals.length ? (
              <Link className="quiet buttonish" to="/approvals">
                {approvalLabel} waiting
              </Link>
            ) : null}
            <Link className="buttonish" to="/tasks/new">
              <span aria-hidden="true">＋</span> New task
            </Link>
          </>
        }
      >
        <div className="system-line" role="status" aria-live="polite">
          <span className={health?.ok ? 'system-dot online' : 'system-dot'} />
          {health?.ok
            ? `Local daemon ready · ${health.host ?? '127.0.0.1'}:${health.port ?? 4178}`
            : 'Connecting to local daemon…'}
        </div>
      </PageHeader>

      <div className="metric-grid" aria-label="Workspace overview">
        <Metric
          label="Needs you"
          value={decisionCount}
          detail={approvals.length ? approvalLabel : 'No decisions waiting'}
          tone={decisionCount ? 'warn' : 'ok'}
        />
        <Metric
          label="Active work"
          value={activeTasks.length}
          detail={activeTasks.length ? 'Agents executing now' : 'Flock is idle'}
          tone={activeTasks.length ? 'info' : 'neutral'}
        />
        <Metric
          label="Accepted"
          value={verifiedTasks.length}
          detail="Verified results accepted"
          tone="ok"
        />
        <Metric
          label="Local usage"
          value={usage ? formatUsage(usage) : '—'}
          detail="Actual and shadow cost stay separate"
        />
      </div>

      <section className="control-grid">
        <article className="attention-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Priority queue</p>
              <h2>{decisionCount ? 'Your decisions unblock the flock' : 'Nothing needs you'}</h2>
            </div>
            {decisionCount ? <span className="attention-count">{decisionCount}</span> : null}
          </div>
          {decisionCount ? (
            <div className="attention-list">
              {needsYou.slice(0, 4).map((task) => (
                <Link key={task.id} to={`/tasks/${task.id}`} className="attention-item">
                  <span className="attention-icon" aria-hidden="true">
                    !
                  </span>
                  <span>
                    <strong>{task.title}</strong>
                    <small>{formatTaskState(task.state)}</small>
                  </span>
                  <span aria-hidden="true">→</span>
                </Link>
              ))}
              {!needsYou.length && approvals.length ? (
                <Link to="/approvals" className="attention-item">
                  <span className="attention-icon" aria-hidden="true">
                    !
                  </span>
                  <span>
                    <strong>{approvalLabel} waiting for review</strong>
                    <small>Open the approval inbox</small>
                  </span>
                  <span aria-hidden="true">→</span>
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="calm-state">
              <span aria-hidden="true">✓</span>
              <p>Approvals, acceptance reviews, and failed verification will appear here.</p>
            </div>
          )}
        </article>

        <article className="delivery-panel">
          <p className="eyebrow">RoleFlock assurance</p>
          <h2>Every change follows a visible path</h2>
          <ol className="delivery-path">
            {['Plan', 'Approve', 'Implement', 'Test', 'Verify', 'Accept'].map((step, index) => (
              <li key={step}>
                <span>{index + 1}</span>
                <strong>{step}</strong>
              </li>
            ))}
          </ol>
          <p className="panel-note">
            Agent output is never treated as verified evidence. Tests, verifier findings, and your
            acceptance remain distinct.
          </p>
        </article>
      </section>

      <Section
        title="Recent work"
        description={`${tasks.length} task${tasks.length === 1 ? '' : 's'} across your registered projects`}
        actions={
          <Link className="text-link" to="/projects">
            Manage projects
          </Link>
        }
      >
        {tasks.length ? (
          <div className="task-list">
            {tasks.slice(0, 8).map((task) => (
              <TaskCard key={task.id} task={task} />
            ))}
          </div>
        ) : (
          <div className="empty-cta">
            <Empty message="No tasks yet. Register a project, then create your first governed task." />
            <div className="actions">
              <Link className="quiet buttonish" to="/projects">
                Add a project
              </Link>
              <Link className="buttonish" to="/tasks/new">
                Create task
              </Link>
            </div>
          </div>
        )}
      </Section>
    </Shell>
  );
}
