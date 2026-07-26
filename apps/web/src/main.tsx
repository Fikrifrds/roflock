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
  workflowGraphVersionId: string;
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
  taskId?: string;
  requestType: string;
  rationale: string;
  riskClass: string;
  fingerprint: string;
};

type Provider = {
  id: string;
  displayName: string;
  status: string;
  capabilities: Record<string, boolean>;
};

type EvidenceBundle = {
  findings: Array<Record<string, unknown>>;
  testRuns: Array<Record<string, unknown>>;
  artefacts: Array<Record<string, unknown>>;
  disclosures: Array<Record<string, unknown>>;
};

type Usage = {
  entries?: Array<Record<string, unknown>>;
  summary?: Record<string, unknown>;
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
          <Link to="/providers">Providers</Link>
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
      <div className="status-strip" aria-label="Flock status">
        <div>
          <span>Daemon</span>
          <b>{health?.ok ? 'Healthy' : 'Checking'}</b>
        </div>
        <div>
          <span>Pending approvals</span>
          <b>{approvals.length}</b>
        </div>
        <div>
          <span>Tasks</span>
          <b>
            {Object.entries(stateCounts).length
              ? Object.entries(stateCounts)
                  .map(([state, count]) => `${count} ${state}`)
                  .join(' · ')
              : 'No tasks'}
          </b>
        </div>
        {usage ? (
          <div>
            <span>Usage</span>
            <b>{formatUsage(usage)}</b>
          </div>
        ) : null}
      </div>
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
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [error, setError] = useState('');
  const [choosing, setChoosing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const suggestNameFromPath = (repoPath: string) => {
    const parts = repoPath.replace(/\/+$/, '').split('/').filter(Boolean);
    return parts[parts.length - 1] ?? '';
  };

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
                body: JSON.stringify({
                  path,
                  name: name.trim() || undefined,
                }),
              });
              setPath('');
              setName('');
              setNameTouched(false);
              void refetch();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Failed to register');
            }
          }}
        >
          <label className="field-label" htmlFor="repo-name">
            Display name
          </label>
          <input
            id="repo-name"
            placeholder="e.g. Tilaqa Web"
            value={name}
            onChange={(e) => {
              setNameTouched(true);
              setName(e.target.value);
            }}
          />
          <label className="field-label" htmlFor="repo-path">
            Local path
          </label>
          <div className="path-row">
            <input
              id="repo-path"
              placeholder="Select or paste a Git repository path"
              value={path}
              onChange={(e) => {
                const next = e.target.value;
                setPath(next);
                if (!nameTouched) setName(suggestNameFromPath(next));
              }}
              required
            />
            <button
              type="button"
              className="quiet"
              disabled={choosing}
              onClick={async () => {
                setError('');
                setChoosing(true);
                try {
                  const result = await api.request<{ path: string | null; cancelled: boolean }>(
                    '/api/dialogs/choose-directory',
                    { method: 'POST' },
                  );
                  if (!result.cancelled && result.path) {
                    setPath(result.path);
                    if (!nameTouched) setName(suggestNameFromPath(result.path));
                  }
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Folder picker failed');
                } finally {
                  setChoosing(false);
                }
              }}
            >
              {choosing ? 'Choosing…' : 'Choose…'}
            </button>
          </div>
          <button type="submit">Add repository</button>
          {error ? <p className="error">{error}</p> : null}
        </form>
        {projects.map((project) => (
          <article className="row" key={project.id}>
            <div className="project-meta">
              {editingId === project.id ? (
                <form
                  className="rename-row"
                  onSubmit={async (event: FormEvent) => {
                    event.preventDefault();
                    try {
                      await api.request(`/api/projects/${project.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ name: editName }),
                      });
                      setEditingId(null);
                      void refetch();
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Rename failed');
                    }
                  }}
                >
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    autoFocus
                    required
                  />
                  <button type="submit">Save</button>
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <b>{project.name}</b>
                  <small>{project.resolvedPath}</small>
                </>
              )}
            </div>
            <div className="row-actions">
              {editingId === project.id ? null : (
                <button
                  type="button"
                  className="quiet"
                  onClick={() => {
                    setEditingId(project.id);
                    setEditName(project.name);
                  }}
                >
                  Rename
                </button>
              )}
              <em>{project.status}</em>
            </div>
          </article>
        ))}
      </Section>
    </Shell>
  );
}

function NewTask() {
  const { data: projects = [] } = useData<Project[]>(['projects'], '/api/projects');
  const { data: workflows = [] } = useData<
    Array<{ id: string; label: string; description: string }>
  >(['workflows'], '/api/workflows');
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    projectId: '',
    title: '',
    brief: '',
    expectedBehaviour: '',
    actualBehaviour: '',
    mode: 'bug_fix',
    maxAttempts: 3,
    maxActualCostUsd: 1,
  });
  return (
    <Shell>
      <Section title="New task">
        <form
          className="stack task-form"
          onSubmit={async (event: FormEvent) => {
            event.preventDefault();
            setError('');
            setSubmitting(true);
            try {
              const task = await api.request<Task>('/api/tasks', {
                method: 'POST',
                body: JSON.stringify({
                  ...form,
                  type: form.mode === 'bug_fix' ? 'bug_fix' : 'feature',
                }),
              });
              // Land on task detail so Start is the obvious next action.
              navigate(`/tasks/${task.id}`);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Failed to create task');
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <label className="field-label" htmlFor="task-project">
            Project
          </label>
          <select
            id="task-project"
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
          <label className="field-label" htmlFor="workflow-mode">
            Workflow mode
          </label>
          <select
            id="workflow-mode"
            value={form.mode}
            onChange={(e) => setForm({ ...form, mode: e.target.value })}
          >
            {(workflows.length
              ? workflows
              : [
                  { id: 'bug_fix', label: 'Verified Bug Fix', description: '' },
                  { id: 'direct', label: 'Direct', description: '' },
                  { id: 'fast', label: 'Fast', description: '' },
                  { id: 'standard', label: 'Standard', description: '' },
                ]
            ).map((workflow) => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.label}
              </option>
            ))}
          </select>
          <small className="hint">
            {workflows.find((workflow) => workflow.id === form.mode)?.description ??
              'Choose the smallest sufficient execution path.'}
          </small>
          <label className="field-label" htmlFor="task-title">
            Title
          </label>
          <input
            id="task-title"
            required
            placeholder="Short task title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <label className="field-label" htmlFor="task-brief">
            Brief
          </label>
          <textarea
            id="task-brief"
            className="compact"
            required
            placeholder="What should the flock fix or build?"
            value={form.brief}
            onChange={(e) => setForm({ ...form, brief: e.target.value })}
          />
          <div className="two-col">
            <div>
              <label className="field-label" htmlFor="task-expected">
                Expected behaviour
              </label>
              <textarea
                id="task-expected"
                className="compact"
                placeholder="Optional"
                value={form.expectedBehaviour}
                onChange={(e) => setForm({ ...form, expectedBehaviour: e.target.value })}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="task-actual">
                Actual behaviour
              </label>
              <textarea
                id="task-actual"
                className="compact"
                placeholder="Optional"
                value={form.actualBehaviour}
                onChange={(e) => setForm({ ...form, actualBehaviour: e.target.value })}
              />
            </div>
          </div>
          <div className="two-col">
            <label>
              Max attempts
              <input
                type="number"
                min={1}
                value={form.maxAttempts}
                onChange={(e) => setForm({ ...form, maxAttempts: Number(e.target.value) })}
              />
            </label>
            <label>
              Budget USD
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.maxActualCostUsd}
                onChange={(e) => setForm({ ...form, maxActualCostUsd: Number(e.target.value) })}
              />
            </label>
          </div>
          {error ? <p className="error">{error}</p> : null}
          <div className="form-actions">
            <button type="submit" disabled={submitting || !form.projectId}>
              {submitting ? 'Sending…' : 'Send to flock'}
            </button>
          </div>
        </form>
      </Section>
    </Shell>
  );
}

function TaskDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [actionError, setActionError] = useState('');
  const [starting, setStarting] = useState(false);
  const { data: task } = useData<Task>(['task', id], `/api/tasks/${id}`, Boolean(id));
  const { data: execution } = useData<ActiveExecution | null>(
    ['execution', id],
    `/api/tasks/${id}/active-execution`,
    Boolean(id),
  );
  const { data: pending = [] } = useData<Approval[]>(
    ['task-approvals', id],
    `/api/tasks/${id}/approvals`,
    Boolean(id),
  );
  const { data: evidence } = useData<{
    findings?: Array<{ severity: string; summary: string; details?: string }>;
  }>(['evidence', id], `/api/evidence/tasks/${id}`, Boolean(id));
  if (!task) {
    return (
      <Shell>
        <Empty message="Loading task..." />
      </Shell>
    );
  }
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['task', id] });
    void qc.invalidateQueries({ queryKey: ['execution', id] });
    void qc.invalidateQueries({ queryKey: ['task-approvals', id] });
    void qc.invalidateQueries({ queryKey: ['approvals'] });
    void qc.invalidateQueries({ queryKey: ['evidence', id] });
  };
  const action = async (name: string) => {
    setActionError('');
    if (name === 'start') setStarting(true);
    try {
      await api.request(`/api/tasks/${id}/${name}`, { method: 'POST' });
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed');
      refresh();
    } finally {
      setStarting(false);
    }
  };
  const decide = async (approvalId: string, decision: 'approve' | 'reject') => {
    setActionError('');
    try {
      await api.request(`/api/approvals/${approvalId}/${decision}`, { method: 'POST' });
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Decision failed');
    }
  };
  const waiting =
    task.state === 'awaiting_confirmation' || task.state === 'awaiting_acceptance' || pending.length > 0;
  const latestError = [...(evidence?.findings ?? [])]
    .reverse()
    .find((finding) => finding.severity === 'error');
  return (
    <Shell>
      <Section title={task.title}>
        <p className="lede">{task.brief}</p>
        {actionError || latestError ? (
          <p className="error">
            {actionError || latestError?.details || latestError?.summary}
          </p>
        ) : null}
        {pending.length > 0 ? (
          <article className="pending-banner">
            <p className="eyebrow">PENDING CONFIRMATION</p>
            <h3>Reviewer is waiting for your decision</h3>
            {pending.map((approval) => (
              <div key={approval.id} className="pending-item">
                <p>
                  <b>{approval.requestType}</b> — {approval.rationale}
                </p>
                <div className="actions">
                  <button type="button" onClick={() => void decide(approval.id, 'approve')}>
                    Approve & continue
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => void decide(approval.id, 'reject')}
                  >
                    Reject
                  </button>
                  <Link className="quiet buttonish" to="/approvals">
                    Open inbox
                  </Link>
                </div>
              </div>
            ))}
          </article>
        ) : null}
        {task.state === 'awaiting_acceptance' && pending.length === 0 ? (
          <article className="pending-banner">
            <p className="eyebrow">HUMAN ACCEPTANCE</p>
            <h3>Verification finished — accept or reject the change</h3>
            <div className="actions">
              <button type="button" onClick={() => void action('accept')}>
                Accept
              </button>
              <button type="button" className="quiet" onClick={() => void action('reject')}>
                Reject
              </button>
            </div>
          </article>
        ) : null}
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
                ['Workflow', task.workflowGraphVersionId],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="actions">
            {task.state === 'ready' || task.state === 'failed' ? (
              <button type="button" disabled={starting} onClick={() => void action('start')}>
                {starting ? 'Starting…' : task.state === 'failed' ? 'Retry' : 'Start'}
              </button>
            ) : null}
            {!waiting && task.state === 'running' ? (
              <>
                <button type="button" className="quiet" onClick={() => void action('pause')}>
                  Pause
                </button>
                <button type="button" className="quiet" onClick={() => void action('stop')}>
                  Stop
                </button>
                <button
                  type="button"
                  className="quiet"
                  onClick={() => void action('force-terminate')}
                >
                  Force
                </button>
              </>
            ) : null}
            <button type="button" className="quiet" onClick={() => void action('cancel')}>
              Cancel
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
                <small>risk {approval.riskClass}</small>
                <small>fingerprint {approval.fingerprint.slice(0, 12)}…</small>
                {approval.taskId ? <Link to={`/tasks/${approval.taskId}`}>Open task</Link> : null}
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
  const { data } = useData<EvidenceBundle>(
    ['evidence', id],
    `/api/evidence/tasks/${id}`,
    Boolean(id),
  );
  const { data: usage } = useData<Usage>(['usage', id], `/api/usage/tasks/${id}`, Boolean(id));
  return (
    <Shell>
      <Section title="Evidence ledger">
        <EvidenceSection title="Findings" items={data?.findings ?? []} />
        <EvidenceSection title="Test runs" items={data?.testRuns ?? []} />
        <EvidenceSection title="Artefacts / diff" items={data?.artefacts ?? []} />
        <EvidenceSection
          title="Usage"
          items={usage ? [usage.summary ?? usage, ...(usage.entries ?? [])] : []}
        />
        <EvidenceSection title="Disclosures" items={data?.disclosures ?? []} />
        <details className="raw-json">
          <summary>Raw JSON</summary>
          <pre>{JSON.stringify({ evidence: data, usage }, null, 2)}</pre>
        </details>
      </Section>
    </Shell>
  );
}

function Providers() {
  const { data: providers = [] } = useData<Provider[]>(['providers'], '/api/providers');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [health, setHealth] = useState<Record<string, string>>({});
  return (
    <Shell>
      <Section title="Providers">
        <p className="lede">Local connections available to the flock. Missing providers are not configured.</p>
        {providers.length ? (
          providers.map((provider) => (
            <article className="provider-card" key={provider.id}>
              <div className="row">
                <div>
                  <b>{provider.displayName}</b>
                  <small>id {provider.id}</small>
                  <small>status {provider.status}</small>
                </div>
                <div className="actions compact-actions">
                  <button
                    type="button"
                    className="quiet"
                    onClick={async () => {
                      setHealth((current) => ({ ...current, [provider.id]: 'Checking…' }));
                      try {
                        const result = await api.request<{ healthy: boolean }>(
                          `/api/providers/${provider.id}/health-check`,
                          { method: 'POST' },
                        );
                        setHealth((current) => ({
                          ...current,
                          [provider.id]: result.healthy ? 'Healthy' : 'Unhealthy',
                        }));
                      } catch (error) {
                        setHealth((current) => ({
                          ...current,
                          [provider.id]: error instanceof Error ? error.message : 'Health check failed',
                        }));
                      }
                    }}
                  >
                    Check health
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpanded((current) => ({ ...current, [provider.id]: !current[provider.id] }))}
                  >
                    {expanded[provider.id] ? 'Hide details' : 'Show details'}
                  </button>
                </div>
              </div>
              <div className="capabilities">
                {Object.entries(provider.capabilities).map(([name, enabled]) => (
                  <span key={name} className={enabled ? 'capability enabled' : 'capability'}>
                    {name}: {enabled ? 'yes' : 'no'}
                  </span>
                ))}
              </div>
              {health[provider.id] ? <p className="hint">Health: {health[provider.id]}</p> : null}
              {expanded[provider.id] ? <ProviderModels providerId={provider.id} /> : null}
            </article>
          ))
        ) : (
          <Empty message="No providers are configured. Claude and other external providers are currently missing." />
        )}
      </Section>
    </Shell>
  );
}

function ProviderModels({ providerId }: { providerId: string }) {
  const { data: models = [], isLoading, isError } = useData<Array<{ id: string; displayName: string }>>(
    ['provider-models', providerId],
    `/api/providers/${providerId}/models`,
  );
  if (isLoading) return <p className="hint">Loading configured models…</p>;
  if (isError) return <p className="error">Configured models could not be loaded.</p>;
  return models.length ? (
    <p className="hint">
      Models: {models.map((model) => `${model.displayName} (${model.id})`).join(', ')}
    </p>
  ) : (
    <p className="hint">No models are configured for this provider.</p>
  );
}

function EvidenceSection({ title, items }: { title: string; items: Array<Record<string, unknown>> }) {
  return (
    <section className="evidence-section">
      <h3>{title}</h3>
      {items.length ? (
        items.map((item, index) => (
          <article className="evidence-item" key={String(item.id ?? index)}>
            {Object.entries(item).map(([key, value]) => (
              <p key={key}>
                <span>{key.replace(/_/g, ' ')}</span> {formatValue(value)}
              </p>
            ))}
          </article>
        ))
      ) : (
        <Empty message={`No ${title.toLowerCase()} recorded yet.`} />
      )}
    </section>
  );
}

function formatValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function formatUsage(usage: Record<string, unknown>): string {
  const actual = usage.actualCostUsd ?? usage.actual_cost_usd;
  const shadow = usage.shadowCostUsd ?? usage.shadow_cost_usd;
  return actual !== undefined || shadow !== undefined
    ? `$${String(actual ?? 0)} actual · $${String(shadow ?? 0)} shadow`
    : 'Available';
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
      <Route path="/providers" element={<Providers />} />
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
