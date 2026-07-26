import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { BrowserRouter, Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { createApi } from './lib/api.js';
import './styles.css';

const api = createApi();
const queryClient = new QueryClient();

type Task = {
  id: string;
  title: string;
  type: string;
  state: string;
  risk: string;
  brief: string;
  maxAttempts: number;
  expectedBehaviour?: string;
  actualBehaviour?: string;
};

type Project = {
  id: string;
  name: string;
  resolvedPath: string;
  status: string;
};

type ActiveExecution = {
  phase: string;
  roleDisplayName: string;
  providerDisplayName: string;
  configuredModelDisplayName: string;
  effort?: string;
  permissionProfileId: string;
  currentActivity?: string;
  activeCommandPreview?: string;
  lastHeartbeatAt: string;
  attempt: number;
  actualCost?: number;
  shadowCost?: number;
};

type Approval = {
  id: string;
  requestType: string;
  rationale: string;
  riskClass: string;
  fingerprint: string;
};

function useData<T>(key: string[], path: string, enabled = true) {
  return useQuery({
    queryKey: key,
    queryFn: () => api.request<T>(path),
    enabled,
    refetchInterval: 2000,
  });
}

function Shell({ children }: { children: ReactNode }) {
  const [live, setLive] = useState(false);
  useEffect(() => {
    void api.bootstrap().then(() => {
      setLive(true);
      return api.stream(() => {
        void queryClient.invalidateQueries();
      });
    });
  }, []);
  return (
    <>
      <header>
        <Link className="wordmark" to="/">
          ROLE<span>FLOCK</span>
        </Link>
        <nav>
          <Link to="/projects">Projects</Link>
          <Link to="/tasks/new">New task</Link>
          <Link to="/approvals">Approvals</Link>
        </nav>
        <i className={live ? 'live' : ''}>{live ? 'DAEMON LINKED' : 'CONNECTING'}</i>
      </header>
      <main>{children}</main>
    </>
  );
}

function Home() {
  const { data: health } = useData<{ ok: boolean; host?: string; port?: number }>(
    ['health'],
    '/api/health',
  );
  const { data: tasks = [] } = useData<Task[]>(['tasks'], '/api/tasks');
  return (
    <Shell>
      <section className="hero">
        <p>LOCAL-FIRST AGENT CONTROL PLANE</p>
        <h1>
          Build with a flock,
          <br />
          keep the steering wheel.
        </h1>
        <div className="health">
          {health?.ok
            ? `● Daemon healthy on ${health.host ?? '127.0.0.1'}:${health.port ?? 4178}`
            : '○ Checking local daemon'}
        </div>
      </section>
      <Section title="Recent flights">
        {tasks.length ? (
          tasks.map((task) => <TaskCard key={task.id} task={task} />)
        ) : (
          <Empty message="No work has entered the flock yet." />
        )}
      </Section>
    </Shell>
  );
}

function Projects() {
  const { data: projects = [], refetch } = useData<Project[]>(['projects'], '/api/projects');
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  return (
    <Shell>
      <Section title="Projects">
        <form
          className="stack"
          onSubmit={async (event: FormEvent) => {
            event.preventDefault();
            setError('');
            try {
              await api.request('/api/projects', {
                method: 'POST',
                body: JSON.stringify({ path }),
              });
              setPath('');
              void refetch();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Failed to register');
            }
          }}
        >
          <input
            placeholder="/absolute/path/to/git/repository"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            required
          />
          <button type="submit">Register local repository</button>
          {error ? <p className="error">{error}</p> : null}
        </form>
        {projects.map((project) => (
          <article className="row" key={project.id}>
            <div>
              <b>{project.name}</b>
              <small>{project.resolvedPath}</small>
            </div>
            <em>{project.status}</em>
          </article>
        ))}
      </Section>
    </Shell>
  );
}

function NewTask() {
  const { data: projects = [] } = useData<Project[]>(['projects'], '/api/projects');
  const navigate = useNavigate();
  const [form, setForm] = useState({
    projectId: '',
    title: '',
    brief: '',
    expectedBehaviour: '',
    actualBehaviour: '',
    maxAttempts: 3,
    maxActualCostUsd: 1,
  });
  return (
    <Shell>
      <Section title="New verified bug fix">
        <form
          className="stack"
          onSubmit={async (event: FormEvent) => {
            event.preventDefault();
            const task = await api.request<Task>('/api/tasks', {
              method: 'POST',
              body: JSON.stringify({ ...form, type: 'bug_fix' }),
            });
            navigate(`/tasks/${task.id}`);
          }}
        >
          <select
            required
            value={form.projectId}
            onChange={(e) => setForm({ ...form, projectId: e.target.value })}
          >
            <option value="">Choose a project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <input
            required
            placeholder="Short task title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <textarea
            required
            placeholder="Brief"
            value={form.brief}
            onChange={(e) => setForm({ ...form, brief: e.target.value })}
          />
          <textarea
            placeholder="Expected behaviour"
            value={form.expectedBehaviour}
            onChange={(e) => setForm({ ...form, expectedBehaviour: e.target.value })}
          />
          <textarea
            placeholder="Actual behaviour"
            value={form.actualBehaviour}
            onChange={(e) => setForm({ ...form, actualBehaviour: e.target.value })}
          />
          <label>
            Max attempts
            <input
              type="number"
              value={form.maxAttempts}
              onChange={(e) => setForm({ ...form, maxAttempts: Number(e.target.value) })}
            />
          </label>
          <label>
            Budget USD
            <input
              type="number"
              value={form.maxActualCostUsd}
              onChange={(e) => setForm({ ...form, maxActualCostUsd: Number(e.target.value) })}
            />
          </label>
          <button type="submit">Send to flock</button>
        </form>
      </Section>
    </Shell>
  );
}

function TaskDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const { data: task } = useData<Task>(['task', id], `/api/tasks/${id}`, Boolean(id));
  const { data: execution } = useData<ActiveExecution>(
    ['execution', id],
    `/api/tasks/${id}/active-execution`,
    Boolean(id),
  );
  if (!task) {
    return (
      <Shell>
        <Empty message="Loading task..." />
      </Shell>
    );
  }
  const action = async (name: string) => {
    await api.request(`/api/tasks/${id}/${name}`, { method: 'POST' });
    void qc.invalidateQueries({ queryKey: ['task', id] });
    void qc.invalidateQueries({ queryKey: ['execution', id] });
  };
  return (
    <Shell>
      <Section title={task.title}>
        <p className="lede">{task.brief}</p>
        <article className="execution">
          <p className="eyebrow">ACTIVE EXECUTION</p>
          <h2>{execution?.phase ?? task.state}</h2>
          <dl>
            {(
              [
                ['Role', execution?.roleDisplayName ?? 'Awaiting start'],
                ['Provider', execution?.providerDisplayName ?? '—'],
                ['Configured model', execution?.configuredModelDisplayName ?? '—'],
                ['Effort', execution?.effort ?? 'standard'],
                ['Permission profile', execution?.permissionProfileId ?? '—'],
                ['Activity', execution?.currentActivity ?? 'Ready'],
                ['Tool / command', execution?.activeCommandPreview ?? '—'],
                ['Heartbeat', execution?.lastHeartbeatAt ?? '—'],
                ['Attempt', `${execution?.attempt ?? 0}/${task.maxAttempts}`],
                [
                  'Cost',
                  `$${(execution?.actualCost ?? 0).toFixed(2)} / shadow $${(execution?.shadowCost ?? 0).toFixed(2)}`,
                ],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="actions">
            <button type="button" onClick={() => void action('start')}>
              Start
            </button>
            <button type="button" className="quiet" onClick={() => void action('pause')}>
              Pause
            </button>
            <button type="button" className="quiet" onClick={() => void action('cancel')}>
              Cancel
            </button>
            <button type="button" onClick={() => void action('accept')}>
              Accept
            </button>
            <button type="button" className="quiet" onClick={() => void action('reject')}>
              Reject
            </button>
            <Link className="quiet buttonish" to={`/tasks/${id}/evidence`}>
              Evidence
            </Link>
          </div>
        </article>
      </Section>
    </Shell>
  );
}

function Approvals() {
  const { data = [], refetch } = useData<Approval[]>(['approvals'], '/api/approvals');
  return (
    <Shell>
      <Section title="Approval inbox">
        {data.length ? (
          data.map((approval) => (
            <article className="row" key={approval.id}>
              <div>
                <b>{approval.requestType}</b>
                <small>{approval.rationale}</small>
                <small>fingerprint {approval.fingerprint.slice(0, 12)}…</small>
              </div>
              <div className="actions">
                <button
                  type="button"
                  onClick={async () => {
                    await api.request(`/api/approvals/${approval.id}/approve`, { method: 'POST' });
                    void refetch();
                  }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="quiet"
                  onClick={async () => {
                    await api.request(`/api/approvals/${approval.id}/reject`, { method: 'POST' });
                    void refetch();
                  }}
                >
                  Reject
                </button>
              </div>
            </article>
          ))
        ) : (
          <Empty message="No confirmations are waiting." />
        )}
      </Section>
    </Shell>
  );
}

function Evidence() {
  const { id = '' } = useParams();
  const { data } = useData<unknown>(['evidence', id], `/api/evidence/tasks/${id}`, Boolean(id));
  const { data: usage } = useData<unknown>(['usage', id], `/api/usage/tasks/${id}`, Boolean(id));
  return (
    <Shell>
      <Section title="Evidence ledger">
        <pre>{JSON.stringify({ evidence: data, usage }, null, 2)}</pre>
      </Section>
    </Shell>
  );
}

function TaskCard({ task }: { task: Task }) {
  return (
    <Link className="row task" to={`/tasks/${task.id}`}>
      <div>
        <b>{task.title}</b>
        <small>
          {task.type} · {task.state}
        </small>
      </div>
      <em>{task.risk}</em>
    </Link>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ message }: { message: string }) {
  return <div className="empty">{message}</div>;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/projects" element={<Projects />} />
      <Route path="/tasks/new" element={<NewTask />} />
      <Route path="/tasks/:id" element={<TaskDetail />} />
      <Route path="/tasks/:id/evidence" element={<Evidence />} />
      <Route path="/approvals" element={<Approvals />} />
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </QueryClientProvider>,
);
