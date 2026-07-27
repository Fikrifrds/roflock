import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Shell } from '../components/Shell.js';
import { TaskCard } from '../components/TaskCard.js';
import { Empty, Section } from '../components/primitives.js';
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

  const stateCounts = tasks.reduce<Record<string, number>>((counts, task) => {
    counts[task.state] = (counts[task.state] ?? 0) + 1;
    return counts;
  }, {});
  const approvalLabel = `${approvals.length} approval${approvals.length === 1 ? '' : 's'}`;

  return (
    <Shell>
      <section className="hero">
        <p>LOCAL-FIRST AGENT CONTROL</p>
        <h1>
          Build with a flock,
          <br />
          keep the steering wheel.
        </h1>
        <div className="health" role="status" aria-live="polite">
          {health?.ok
            ? `Daemon healthy on ${health.host ?? '127.0.0.1'}:${health.port ?? 4178}`
            : 'Checking local daemon…'}
        </div>
        <div className="hero-actions">
          <Link className="buttonish" to="/tasks/new">
            New task
          </Link>
          <Link className="quiet buttonish" to="/projects">
            Projects
          </Link>
          {approvals.length ? (
            <Link className="quiet buttonish" to="/approvals">
              {approvalLabel} waiting
            </Link>
          ) : null}
        </div>
      </section>

      <div className="status-strip" aria-label="Flock status">
        <div>
          <span>Daemon</span>
          <b>{health?.ok ? 'Healthy' : 'Checking'}</b>
        </div>
        <div>
          <span>Needs you</span>
          <b>{approvals.length ? approvalLabel : 'Nothing pending'}</b>
        </div>
        <div>
          <span>Tasks</span>
          <b>
            {tasks.length
              ? `${tasks.length} total · ${Object.entries(stateCounts)
                  .map(([state, count]) => `${count} ${formatTaskState(state).toLowerCase()}`)
                  .slice(0, 3)
                  .join(', ')}`
              : 'None yet'}
          </b>
        </div>
        {usage ? (
          <div>
            <span>Local usage</span>
            <b>{formatUsage(usage)}</b>
          </div>
        ) : null}
      </div>

      <Section title="Recent tasks">
        {tasks.length ? (
          tasks.map((task) => <TaskCard key={task.id} task={task} />)
        ) : (
          <div className="empty-cta">
            <Empty message="No tasks yet. Register a project, then create a Verified Fix task." />
            <div className="actions">
              <Link className="buttonish" to="/projects">
                Add a project
              </Link>
              <Link className="quiet buttonish" to="/tasks/new">
                Create a task
              </Link>
            </div>
          </div>
        )}
      </Section>
    </Shell>
  );
}
