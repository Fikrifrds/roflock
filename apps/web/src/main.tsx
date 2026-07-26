import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { BrowserRouter, Link, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { createApi } from './lib/api.js';
import './styles.css';

const api = createApi();
const queryClient = new QueryClient();

type KnowledgeItem = {
  id: string;
  projectId?: string;
  type: string;
  title: string;
  body: string;
  state: string;
  provenance?: string;
  createdAt: string;
};

type DisclosureGrant = {
  id: string;
  projectId: string;
  providerConnectionId: string;
  scope: Record<string, unknown>;
  createdAt: string;
  revokedAt?: string;
};

type Task = {
  id: string;
  title: string;
  type: string;
  state: string;
  risk: string;
  brief: string;
  maxAttempts: number;
  maxActualCostUsd?: number;
  workflowGraphVersionId: string;
  expectedBehaviour?: string;
  actualBehaviour?: string;
  verificationCommand?: string;
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
  usageConfidence?: string;
};

type Approval = {
  id: string;
  taskId?: string;
  requestType: string;
  rationale: string;
  riskClass: string;
  fingerprint: string;
};

type TaskDocument = {
  id: string;
  fileName: string;
  kind: string;
  authority: string;
  sha256: string;
  byteSize: number;
  hasExtractedText?: boolean;
  extractedTextPreview?: string;
  createdAt: string;
};

type Provider = {
  id: string;
  displayName: string;
  status: string;
  connectionType?: string;
  health?: { status: string; detail?: string };
  capabilities: Record<string, boolean>;
  account?: {
    loggedIn: boolean;
    email?: string;
    label?: string;
    authMethod?: string;
    subscriptionType?: string;
    orgName?: string;
    supportsLogin: boolean;
    supportsSwitch: boolean;
    detail?: string;
    usageLinks?: Array<{ id: string; label: string; url: string; hint?: string }>;
    commandHints?: { login: string; logout: string; switch: string };
  };
  localUsage?: {
    entryCount: number;
    inputTokens: number;
    outputTokens: number;
    actualCostUsd: number;
    shadowCostUsd: number;
    note: string;
  };
};

type EvidenceBundle = {
  findings: Array<Record<string, unknown>>;
  testRuns: Array<Record<string, unknown>>;
  artefacts: Array<Record<string, unknown>>;
  disclosures: Array<Record<string, unknown>>;
};

type Usage = {
  scope?: string;
  note?: string;
  entries?: Array<Record<string, unknown>>;
  summary?: {
    actualCostUsd?: number;
    shadowCostUsd?: number;
    inputTokens?: number;
    outputTokens?: number;
    budget?: {
      remainingUsd?: number;
      warning?: boolean;
      hardStop?: boolean;
      maxActualCostUsd?: number;
    };
  };
};

function useData<T>(key: string[], path: string, enabled = true) {
  return useQuery({
    queryKey: key,
    queryFn: () => api.request<T>(path),
    enabled,
    refetchInterval: 2000,
  });
}

const TASK_STATE_LABELS: Record<string, string> = {
  ready: 'Ready to start',
  running: 'Running',
  paused: 'Paused',
  awaiting_confirmation: 'Needs approval',
  awaiting_acceptance: 'Needs acceptance',
  succeeded: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

function formatTaskState(state: string): string {
  return TASK_STATE_LABELS[state] ?? state.replaceAll('_', ' ');
}

function taskStateTone(state: string): 'ok' | 'warn' | 'danger' | 'muted' | 'info' {
  if (state === 'succeeded') return 'ok';
  if (state === 'failed' || state === 'cancelled') return 'danger';
  if (state === 'awaiting_confirmation' || state === 'awaiting_acceptance') return 'warn';
  if (state === 'running') return 'info';
  return 'muted';
}

function formatPhase(phase: string | undefined, state: string): string {
  if (!phase) return formatTaskState(state);
  const labels: Record<string, string> = {
    reasoning: 'Thinking',
    writing: 'Writing changes',
    running_tests: 'Running verification',
    awaiting_confirmation: 'Waiting for approval',
    awaiting_acceptance: 'Waiting for acceptance',
  };
  return labels[phase] ?? phase.replaceAll('_', ' ');
}

function providerTone(provider: Provider): 'ok' | 'warn' | 'danger' | 'muted' | 'info' {
  if (provider.status === 'missing' || provider.status === 'error') return 'danger';
  if (
    provider.status === 'unauthenticated' ||
    (provider.account && !provider.account.loggedIn && provider.account.supportsLogin)
  ) {
    return 'warn';
  }
  if (provider.status === 'ready') return 'ok';
  return 'muted';
}

function providerStatusLabel(provider: Provider): string {
  if (provider.status === 'missing') return 'Not installed';
  if (provider.status === 'error') return 'Error';
  if (
    provider.status === 'unauthenticated' ||
    (provider.account && !provider.account.loggedIn && provider.account.supportsLogin)
  ) {
    return 'Sign in required';
  }
  if (provider.status === 'ready') return 'Ready';
  return provider.status;
}

function StatusPill({
  tone,
  children,
}: {
  tone: 'ok' | 'warn' | 'danger' | 'muted' | 'info';
  children: ReactNode;
}) {
  return <span className={`status-pill ${tone}`}>{children}</span>;
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
        <nav aria-label="Primary">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/projects">Projects</NavLink>
          <NavLink to="/tasks/new">New task</NavLink>
          <NavLink to="/approvals">Approvals</NavLink>
          <NavLink to="/providers">Providers</NavLink>
          <NavLink to="/knowledge" className="nav-secondary">
            Knowledge
          </NavLink>
          <NavLink to="/privacy" className="nav-secondary">
            Privacy
          </NavLink>
        </nav>
        <i className={live ? 'live' : ''}>{live ? 'Connected' : 'Connecting…'}</i>
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
        <p>LOCAL-FIRST AGENT CONTROL</p>
        <h1>
          Build with a flock,
          <br />
          keep the steering wheel.
        </h1>
        <div className="health">
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
              {approvals.length} approval{approvals.length === 1 ? '' : 's'} waiting
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
          <b>{approvals.length ? `${approvals.length} approval${approvals.length === 1 ? '' : 's'}` : 'Nothing pending'}</b>
        </div>
        <div>
          <span>Tasks</span>
          <b>
            {tasks.length
              ? `${tasks.length} total · ${
                  Object.entries(stateCounts)
                    .map(([state, count]) => `${count} ${formatTaskState(state).toLowerCase()}`)
                    .slice(0, 3)
                    .join(', ')
                }`
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

function Projects() {
  const { data: projects = [], refetch, isLoading } = useData<Project[]>(['projects'], '/api/projects');
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
        <p className="lede">
          Register a local Git repository. Tasks run inside an isolated worktree of that repo.
        </p>
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
              {choosing ? 'Choosing…' : 'Choose folder'}
            </button>
          </div>
          <button type="submit">Add project</button>
          {error ? <p className="error">{error}</p> : null}
        </form>
        {isLoading ? <Empty message="Loading projects…" /> : null}
        {!isLoading && projects.length === 0 ? (
          <Empty message="No projects yet. Add a repository above to create tasks." />
        ) : null}
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
  const { data: intents = [] } = useData<
    Array<{ id: string; label: string; description: string }>
  >(['task-intents'], '/api/task-intents');
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [modeTouched, setModeTouched] = useState(false);
  const [pendingDocs, setPendingDocs] = useState<
    Array<{ fileName: string; kind: string; authority: string; content: string }>
  >([]);
  const [docDraft, setDocDraft] = useState({
    kind: 'prd',
    authority: 'reference',
  });
  const [form, setForm] = useState({
    projectId: '',
    type: 'bug_fix',
    risk: 'medium',
    title: '',
    brief: '',
    expectedBehaviour: '',
    actualBehaviour: '',
    verificationCommand: '',
    mode: 'bug_fix',
    maxAttempts: 3,
    maxActualCostUsd: 1,
  });
  const { data: recommendation } = useData<{
    mode: string;
    rationale: string;
    label: string;
  }>(
    ['workflow-recommend', form.type, form.risk],
    `/api/workflows/recommend?type=${encodeURIComponent(form.type)}&risk=${encodeURIComponent(form.risk)}`,
  );

  useEffect(() => {
    if (!modeTouched && recommendation?.mode) {
      setForm((current) =>
        current.mode === recommendation.mode
          ? current
          : { ...current, mode: recommendation.mode },
      );
    }
  }, [recommendation?.mode, modeTouched]);

  useEffect(() => {
    if (!form.projectId && projects[0]) {
      setForm((current) => ({ ...current, projectId: projects[0]!.id }));
    }
  }, [projects, form.projectId]);

  const noProjects = projects.length === 0;

  return (
    <Shell>
      <Section title="New task">
        <p className="lede">
          Pick a project, describe the work, and send it. RoleFlock chooses a workflow unless you
          override it below.
        </p>
        {noProjects ? (
          <div className="empty-cta">
            <Empty message="Add a project first, then come back to create a task." />
            <div className="actions">
              <Link className="buttonish" to="/projects">
                Go to Projects
              </Link>
            </div>
          </div>
        ) : (
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
                  projectId: form.projectId,
                  type: form.type,
                  risk: form.risk,
                  title: form.title,
                  brief: form.brief,
                  expectedBehaviour: form.expectedBehaviour || undefined,
                  actualBehaviour: form.actualBehaviour || undefined,
                  verificationCommand: form.verificationCommand || undefined,
                  mode: form.mode,
                  maxAttempts: form.maxAttempts,
                  maxActualCostUsd: form.maxActualCostUsd,
                }),
              });
              for (const doc of pendingDocs) {
                await api.request(`/api/tasks/${task.id}/documents`, {
                  method: 'POST',
                  body: JSON.stringify(doc),
                });
              }
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
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>

          <p className="field-label">What are you working on?</p>
          <div className="intent-grid" role="listbox" aria-label="Task intent">
            {(intents.length
              ? intents
              : [
                  { id: 'bug_fix', label: 'Fix a Bug', description: '' },
                  { id: 'feature', label: 'Add a Feature', description: '' },
                  { id: 'investigation', label: 'Investigate', description: '' },
                ]
            ).map((intent) => (
              <button
                key={intent.id}
                type="button"
                role="option"
                aria-selected={form.type === intent.id}
                className={form.type === intent.id ? 'intent selected' : 'intent'}
                onClick={() => {
                  setModeTouched(false);
                  setForm({ ...form, type: intent.id });
                }}
              >
                <strong>{intent.label}</strong>
                {intent.description ? <small>{intent.description}</small> : null}
              </button>
            ))}
          </div>

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
          {form.type === 'bug_fix' ? (
            <div className="two-col">
              <div>
                <label className="field-label" htmlFor="task-expected">
                  Expected
                </label>
                <textarea
                  id="task-expected"
                  className="compact"
                  placeholder="What should happen?"
                  value={form.expectedBehaviour}
                  onChange={(e) => setForm({ ...form, expectedBehaviour: e.target.value })}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="task-actual">
                  Actual
                </label>
                <textarea
                  id="task-actual"
                  className="compact"
                  placeholder="What happens instead?"
                  value={form.actualBehaviour}
                  onChange={(e) => setForm({ ...form, actualBehaviour: e.target.value })}
                />
              </div>
            </div>
          ) : null}

          <details className="advanced-panel">
            <summary>Advanced options</summary>
            <p className="hint">
              {recommendation
                ? `Suggested workflow: ${recommendation.label}. ${recommendation.rationale}${
                    modeTouched && form.mode !== recommendation.mode ? ' (overridden)' : ''
                  }`
                : 'Leave defaults unless you need a heavier path or custom verification.'}
            </p>
            <label className="field-label" htmlFor="task-risk">
              Risk
            </label>
            <select
              id="task-risk"
              value={form.risk}
              onChange={(e) => {
                setModeTouched(false);
                setForm({ ...form, risk: e.target.value });
              }}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>

            <label className="field-label" htmlFor="workflow-mode">
              Workflow
            </label>
            <select
              id="workflow-mode"
              value={form.mode}
              onChange={(e) => {
                setModeTouched(true);
                setForm({ ...form, mode: e.target.value });
              }}
            >
              {(workflows.length
                ? workflows
                : [
                    { id: 'bug_fix', label: 'Verified Bug Fix', description: '' },
                    { id: 'direct', label: 'Direct', description: '' },
                    { id: 'fast', label: 'Fast', description: '' },
                    { id: 'standard', label: 'Standard', description: '' },
                    { id: 'critical', label: 'Critical Feature', description: '' },
                  ]
              ).map((workflow) => (
                <option key={workflow.id} value={workflow.id}>
                  {workflow.label}
                </option>
              ))}
            </select>

            <label className="field-label" htmlFor="task-verify">
              Verification command
            </label>
            <input
              id="task-verify"
              placeholder="Optional — e.g. npm test"
              value={form.verificationCommand}
              onChange={(e) => setForm({ ...form, verificationCommand: e.target.value })}
            />
            <p className="hint">
              Runs in the worktree after the writer. Blank uses <code>npm test</code> when present.
            </p>
            <div className="two-col">
              <div>
                <label className="field-label" htmlFor="task-attempts">
                  Max attempts
                </label>
                <input
                  id="task-attempts"
                  type="number"
                  min={1}
                  value={form.maxAttempts}
                  onChange={(e) => setForm({ ...form, maxAttempts: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="task-budget">
                  Max cost (USD)
                </label>
                <input
                  id="task-budget"
                  type="number"
                  min={0}
                  step={0.01}
                  value={form.maxActualCostUsd}
                  onChange={(e) => setForm({ ...form, maxActualCostUsd: Number(e.target.value) })}
                />
              </div>
            </div>

            <p className="field-label">Supporting documents</p>
            <p className="hint">Optional. Stored locally with a hash.</p>
            <div className="two-col">
              <div>
                <label className="field-label" htmlFor="doc-kind">
                  Kind
                </label>
                <select
                  id="doc-kind"
                  value={docDraft.kind}
                  onChange={(e) => setDocDraft({ ...docDraft, kind: e.target.value })}
                >
                  <option value="prd">PRD</option>
                  <option value="implementation_plan">Implementation plan</option>
                  <option value="architecture">Architecture</option>
                  <option value="api_spec">API spec</option>
                  <option value="ticket">Ticket</option>
                  <option value="research">Research</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="doc-authority">
                  Authority
                </label>
                <select
                  id="doc-authority"
                  value={docDraft.authority}
                  onChange={(e) => setDocDraft({ ...docDraft, authority: e.target.value })}
                >
                  <option value="authoritative_requirement">Authoritative requirement</option>
                  <option value="approved_plan">Approved plan</option>
                  <option value="reference">Reference</option>
                  <option value="inspiration_only">Inspiration only</option>
                </select>
              </div>
            </div>
            <label className="field-label" htmlFor="doc-file">
              Attach text file
            </label>
            <input
              id="doc-file"
              type="file"
              accept=".md,.txt,.json,.yaml,.yml,.csv"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const content = await file.text();
                setPendingDocs((current) => [
                  ...current,
                  {
                    fileName: file.name,
                    kind: docDraft.kind,
                    authority: docDraft.authority,
                    content,
                  },
                ]);
                e.target.value = '';
              }}
            />
            {pendingDocs.length ? (
              <ul className="doc-list">
                {pendingDocs.map((doc, index) => (
                  <li key={`${doc.fileName}-${index}`}>
                    {doc.fileName} · {doc.kind}
                    <button
                      type="button"
                      className="quiet"
                      onClick={() =>
                        setPendingDocs((current) => current.filter((_, i) => i !== index))
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </details>

          {error ? <p className="error">{error}</p> : null}
          <div className="form-actions">
            <button type="submit" disabled={submitting || !form.projectId}>
              {submitting ? 'Creating…' : 'Create task'}
            </button>
          </div>
        </form>
        )}
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
  const { data: workflows = [] } = useData<
    Array<{ id: string; label: string; description: string; roles: string[] }>
  >(['workflows'], '/api/workflows');
  const workflow = workflows.find((item) => item.id === task?.workflowGraphVersionId);
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
  const { data: taskDocuments = [] } = useData<TaskDocument[]>(
    ['task-documents', id],
    `/api/tasks/${id}/documents`,
    Boolean(id),
  );
  const [docDraft, setDocDraft] = useState({ kind: 'prd', authority: 'reference' });
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
    void qc.invalidateQueries({ queryKey: ['task-documents', id] });
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
        <div className="task-header">
          <StatusPill tone={taskStateTone(task.state)}>{formatTaskState(task.state)}</StatusPill>
          <small>
            {task.type.replaceAll('_', ' ')} · risk {task.risk} · {task.workflowGraphVersionId}
          </small>
        </div>
        <p className="lede">{task.brief}</p>
        {actionError || latestError ? (
          <p className="error">
            {actionError || latestError?.details || latestError?.summary}
          </p>
        ) : null}

        <div className="actions primary-actions">
          {task.state === 'ready' || task.state === 'failed' ? (
            <button type="button" disabled={starting} onClick={() => void action('start')}>
              {starting ? 'Starting…' : task.state === 'failed' ? 'Retry task' : 'Start task'}
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
                className="danger"
                title="Kill the active process immediately"
                onClick={() => void action('force-terminate')}
              >
                Force stop
              </button>
            </>
          ) : null}
          {task.state === 'paused' ? (
            <button type="button" onClick={() => void action('start')}>
              Resume
            </button>
          ) : null}
          {task.state === 'running' || task.state === 'paused' || waiting ? (
            <button type="button" className="quiet" onClick={() => void action('cancel')}>
              Cancel task
            </button>
          ) : null}
          <Link className="quiet buttonish" to={`/tasks/${id}/evidence`}>
            Evidence
          </Link>
        </div>

        {pending.length > 0 ? (
          <article className="pending-banner">
            <p className="eyebrow">YOUR DECISION NEEDED</p>
            <h3>Approve to continue, or reject to stop this step</h3>
            {pending.map((approval) => (
              <div key={approval.id} className="pending-item">
                <p>
                  <b>{approval.requestType.replaceAll('_', ' ')}</b> — {approval.rationale}
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
            <p className="eyebrow">ACCEPT THE RESULT</p>
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

        {workflow ? (
          <ol className="workflow-steps" aria-label="Workflow steps">
            {workflow.roles.map((role) => {
              const active = execution?.roleDisplayName === role;
              return (
                <li key={role} className={active ? 'active' : undefined}>
                  {role}
                </li>
              );
            })}
          </ol>
        ) : null}

        <article className="execution">
          <p className="eyebrow">NOW</p>
          <h2>{formatPhase(execution?.phase, task.state)}</h2>
          <dl>
            {(
              [
                ['Current role', execution?.roleDisplayName ?? 'Waiting to start'],
                ['Provider', execution?.providerDisplayName ?? '—'],
                ['Activity', execution?.currentActivity ?? 'Idle'],
                ['Attempt', `${execution?.attempt ?? 0} / ${task.maxAttempts}`],
                [
                  'Actual cost',
                  `$${(execution?.actualCost ?? 0).toFixed(4)}`,
                ],
                [
                  'Budget left',
                  task.maxActualCostUsd === undefined
                    ? 'No hard cap'
                    : `$${Math.max(0, task.maxActualCostUsd - (execution?.actualCost ?? 0)).toFixed(4)}`,
                ],
              ] as const
            ).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <details className="raw-json">
            <summary>More run details</summary>
            <dl>
              {(
                [
                  ['Model', execution?.configuredModelDisplayName ?? '—'],
                  ['Effort', execution?.effort ?? 'standard'],
                  ['Permission', execution?.permissionProfileId ?? '—'],
                  ['Command', execution?.activeCommandPreview ?? '—'],
                  ['Heartbeat', execution?.lastHeartbeatAt ?? '—'],
                  [
                    'Shadow cost',
                    `$${(execution?.shadowCost ?? 0).toFixed(4)} (estimate, not a bill)`,
                  ],
                  ['Usage confidence', execution?.usageConfidence ?? 'exact'],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </details>
        </article>

        <details className="documents-panel">
          <summary className="eyebrow">Supporting documents ({taskDocuments.length})</summary>
          {taskDocuments.length ? (
            <ul className="doc-list">
              {taskDocuments.map((doc) => (
                <li key={doc.id}>
                  <div>
                    <b>{doc.fileName}</b>
                    <small>
                      {doc.kind} · {doc.authority}
                    </small>
                    {doc.extractedTextPreview ? (
                      <small>{doc.extractedTextPreview}</small>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">Optional. Attach notes that should inform planning.</p>
          )}
          <div className="two-col">
            <select
              value={docDraft.kind}
              onChange={(e) => setDocDraft({ ...docDraft, kind: e.target.value })}
            >
              <option value="prd">PRD</option>
              <option value="implementation_plan">Implementation plan</option>
              <option value="architecture">Architecture</option>
              <option value="api_spec">API spec</option>
              <option value="ticket">Ticket</option>
              <option value="research">Research</option>
              <option value="other">Other</option>
            </select>
            <select
              value={docDraft.authority}
              onChange={(e) => setDocDraft({ ...docDraft, authority: e.target.value })}
            >
              <option value="authoritative_requirement">Authoritative requirement</option>
              <option value="approved_plan">Approved plan</option>
              <option value="reference">Reference</option>
              <option value="inspiration_only">Inspiration only</option>
            </select>
          </div>
          <input
            type="file"
            accept=".md,.txt,.json,.yaml,.yml,.csv"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              try {
                const content = await file.text();
                await api.request(`/api/tasks/${id}/documents`, {
                  method: 'POST',
                  body: JSON.stringify({
                    fileName: file.name,
                    kind: docDraft.kind,
                    authority: docDraft.authority,
                    content,
                    mimeType: file.type || 'text/plain',
                  }),
                });
                refresh();
              } catch (error) {
                setActionError(error instanceof Error ? error.message : 'Upload failed');
              } finally {
                e.target.value = '';
              }
            }}
          />
        </details>
      </Section>
    </Shell>
  );
}

function Approvals() {
  const { data = [], refetch } = useData<Approval[]>(['approvals'], '/api/approvals');
  const [grantOffer, setGrantOffer] = useState<{
    approval: Approval;
    projectId: string;
  } | null>(null);
  const [grantNote, setGrantNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const fingerprintCounts = data.reduce<Record<string, number>>((counts, approval) => {
    counts[approval.fingerprint] = (counts[approval.fingerprint] ?? 0) + 1;
    return counts;
  }, {});

  const grantMaximumRisk = (risk: string): 'low' | 'medium' | 'high' =>
    risk === 'critical' ? 'high' : risk === 'low' || risk === 'medium' || risk === 'high' ? risk : 'medium';

  const approve = async (approval: Approval, alsoOfferGrant = true) => {
    setBusy(approval.id);
    setGrantNote('');
    try {
      await api.request(`/api/approvals/${approval.id}/approve`, { method: 'POST' });
      if (alsoOfferGrant && approval.taskId) {
        try {
          const task = await api.request<{ projectId: string }>(`/api/tasks/${approval.taskId}`);
          setGrantOffer({ approval, projectId: task.projectId });
        } catch {
          setGrantOffer(null);
        }
      }
      void refetch();
    } finally {
      setBusy(null);
    }
  };

  const createGrant = async () => {
    if (!grantOffer) return;
    setGrantNote('');
    try {
      await api.request('/api/approval-grants', {
        method: 'POST',
        body: JSON.stringify({
          projectId: grantOffer.projectId,
          scope: 'exact_fingerprint',
          fingerprint: grantOffer.approval.fingerprint,
          requestTypes: [grantOffer.approval.requestType],
          maximumRisk: grantMaximumRisk(grantOffer.approval.riskClass),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          maximumApplications: 25,
        }),
      });
      setGrantNote('Reuse grant saved for 24 hours.');
      setGrantOffer(null);
    } catch (error) {
      setGrantNote(error instanceof Error ? error.message : 'Failed to create grant');
    }
  };

  return (
    <Shell>
      <Section title="Approvals">
        <p className="lede">Decisions waiting before a task can continue.</p>
        {data.length ? (
          data.map((approval) => {
            const sameFingerprint = fingerprintCounts[approval.fingerprint] ?? 1;
            return (
              <article className="row" key={approval.id}>
                <div>
                  <b>{approval.requestType.replaceAll('_', ' ')}</b>
                  <small>{approval.rationale}</small>
                  <small>Risk: {approval.riskClass}</small>
                  {sameFingerprint > 1 ? (
                    <small>{sameFingerprint} similar requests pending</small>
                  ) : null}
                  {approval.taskId ? (
                    <Link to={`/tasks/${approval.taskId}`}>Open related task</Link>
                  ) : null}
                </div>
                <div className="actions">
                  <button
                    type="button"
                    disabled={busy === approval.id}
                    onClick={() => void approve(approval)}
                  >
                    {busy === approval.id ? 'Approving…' : 'Approve'}
                  </button>
                  {sameFingerprint > 1 ? (
                    <button
                      type="button"
                      className="quiet"
                      onClick={async () => {
                        setBusy(approval.id);
                        try {
                          await api.request(
                            `/api/approval-groups/${approval.id}/approve-all-once`,
                            { method: 'POST' },
                          );
                          void refetch();
                        } finally {
                          setBusy(null);
                        }
                      }}
                    >
                      Approve all once
                    </button>
                  ) : null}
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
            );
          })
        ) : (
          <Empty message="Nothing waiting. When a reviewer needs you, it shows up here." />
        )}
        {grantOffer ? (
          <article className="pending-banner">
            <p className="eyebrow">OPTIONAL</p>
            <h3>Remember this approval for 24 hours?</h3>
            <p className="hint">
              Matching confirmations can continue without asking again.
            </p>
            <div className="actions">
              <button type="button" onClick={() => void createGrant()}>
                Remember for 24h
              </button>
              <button type="button" className="quiet" onClick={() => setGrantOffer(null)}>
                Not now
              </button>
            </div>
          </article>
        ) : null}
        {grantNote ? <p className="hint">{grantNote}</p> : null}
      </Section>
    </Shell>
  );
}

function Knowledge() {
  const { data: projects = [] } = useData<Project[]>(['projects'], '/api/projects');
  const [typeFilter, setTypeFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const query = [
    projectFilter ? `projectId=${encodeURIComponent(projectFilter)}` : '',
    typeFilter ? `type=${encodeURIComponent(typeFilter)}` : '',
    stateFilter ? `state=${encodeURIComponent(stateFilter)}` : '',
  ]
    .filter(Boolean)
    .join('&');
  const { data = [], refetch } = useData<KnowledgeItem[]>(
    ['knowledge', projectFilter, typeFilter, stateFilter],
    `/api/knowledge${query ? `?${query}` : ''}`,
  );
  const [form, setForm] = useState({
    projectId: '',
    type: 'coding_convention',
    title: '',
    body: '',
    state: 'candidate' as 'candidate' | 'published',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <Shell>
      <Section title="Knowledge">
        <p className="lede">
          Notes that can be included in agent context when marked published. Drafts stay as
          candidates until you promote them.
        </p>
        <form
          className="stack"
          onSubmit={async (event: FormEvent) => {
            event.preventDefault();
            setError('');
            setSaving(true);
            try {
              await api.request('/api/knowledge', {
                method: 'POST',
                body: JSON.stringify({
                  projectId: form.projectId || undefined,
                  type: form.type,
                  title: form.title,
                  body: form.body,
                  state: form.state,
                }),
              });
              setForm((current) => ({ ...current, title: '', body: '' }));
              void refetch();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Failed to save knowledge');
            } finally {
              setSaving(false);
            }
          }}
        >
          <label className="field-label" htmlFor="knowledge-project">
            Project (optional)
          </label>
          <select
            id="knowledge-project"
            value={form.projectId}
            onChange={(e) => setForm({ ...form, projectId: e.target.value })}
          >
            <option value="">Workspace-wide</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <div className="two-col">
            <div>
              <label className="field-label" htmlFor="knowledge-type">
                Type
              </label>
              <select
                id="knowledge-type"
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                <option value="architecture_decision">Architecture decision</option>
                <option value="coding_convention">Coding convention</option>
                <option value="past_failure">Past failure</option>
                <option value="review_rule">Review rule</option>
                <option value="test_pattern">Test pattern</option>
                <option value="security_rule">Security rule</option>
                <option value="rejected_approach">Rejected approach</option>
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="knowledge-state">
                State
              </label>
              <select
                id="knowledge-state"
                value={form.state}
                onChange={(e) =>
                  setForm({ ...form, state: e.target.value as 'candidate' | 'published' })
                }
              >
                <option value="candidate">Candidate</option>
                <option value="published">Published</option>
              </select>
            </div>
          </div>
          <label className="field-label" htmlFor="knowledge-title">
            Title
          </label>
          <input
            id="knowledge-title"
            required
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <label className="field-label" htmlFor="knowledge-body">
            Body
          </label>
          <textarea
            id="knowledge-body"
            className="compact"
            required
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
          {error ? <p className="error">{error}</p> : null}
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Add knowledge'}
          </button>
        </form>
      </Section>
      <Section title="Library">
        <div className="two-col">
          <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}>
            <option value="">All projects</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            <option value="architecture_decision">Architecture decision</option>
            <option value="coding_convention">Coding convention</option>
            <option value="past_failure">Past failure</option>
            <option value="review_rule">Review rule</option>
            <option value="test_pattern">Test pattern</option>
            <option value="security_rule">Security rule</option>
            <option value="rejected_approach">Rejected approach</option>
          </select>
          <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
            <option value="">All states</option>
            <option value="candidate">Candidate</option>
            <option value="published">Published</option>
          </select>
        </div>
        {data.length ? (
          data.map((item) => (
            <article className="row" key={item.id}>
              <div>
                <b>{item.title}</b>
                <small>
                  {item.type} · {item.state}
                  {item.projectId ? ` · project ${item.projectId.slice(0, 8)}…` : ' · workspace'}
                </small>
                <small>{item.body.slice(0, 240)}{item.body.length > 240 ? '…' : ''}</small>
              </div>
              <em>{new Date(item.createdAt).toLocaleString()}</em>
            </article>
          ))
        ) : (
          <Empty message="No knowledge items match these filters." />
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
  const [exportNote, setExportNote] = useState('');
  const downloadJson = async (path: string, filename: string) => {
    setExportNote('');
    try {
      const payload = await api.request<unknown>(path);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportNote(`Downloaded ${filename}`);
    } catch (error) {
      setExportNote(error instanceof Error ? error.message : 'Export failed');
    }
  };
  return (
    <Shell>
      <Section title="Evidence ledger">
        <div className="actions">
          <button
            type="button"
            className="quiet"
            onClick={() => void downloadJson(`/api/tasks/${id}/export/evidence`, `roleflock-evidence-${id}.json`)}
          >
            Export evidence bundle
          </button>
          <button
            type="button"
            className="quiet"
            onClick={() => void downloadJson(`/api/tasks/${id}/export/audit`, `roleflock-audit-${id}.json`)}
          >
            Export audit pack
          </button>
        </div>
        {exportNote ? <p className="hint">{exportNote}</p> : null}
        <EvidenceSection title="Findings" items={data?.findings ?? []} />
        <EvidenceSection title="Test runs" items={data?.testRuns ?? []} />
        <EvidenceSection title="Artefacts / diff" items={data?.artefacts ?? []} />
        <section className="evidence-section">
          <h3>Usage</h3>
          {usage?.summary ? (
            <article className="evidence-item">
              <p>
                <span>scope</span> {usage.scope ?? 'local-daemon'}
              </p>
              <p>
                <span>actual cost</span> ${(usage.summary.actualCostUsd ?? 0).toFixed(4)}
              </p>
              <p>
                <span>shadow cost</span> ${(usage.summary.shadowCostUsd ?? 0).toFixed(4)} (not a
                bill)
              </p>
              {usage.summary.budget ? (
                <p>
                  <span>budget</span>{' '}
                  {usage.summary.budget.maxActualCostUsd === undefined
                    ? 'uncapped'
                    : `$${usage.summary.budget.remainingUsd?.toFixed(4) ?? '0'} remaining${
                        usage.summary.budget.warning ? ' · warning' : ''
                      }${usage.summary.budget.hardStop ? ' · hard stop' : ''}`}
                </p>
              ) : null}
              {usage.note ? <p className="hint">{usage.note}</p> : null}
            </article>
          ) : (
            <Empty message="No usage recorded yet." />
          )}
          <EvidenceSection title="Ledger entries" items={usage?.entries ?? []} />
        </section>
        <EvidenceSection title="Disclosures" items={data?.disclosures ?? []} />
        <section className="evidence-section">
          <h3>Context inspector</h3>
          {(data?.disclosures ?? []).length ? (
            (data?.disclosures ?? []).map((row, index) => {
              const selectedRaw = parseJsonField(
                (row as { selected_context_json?: string }).selected_context_json,
              );
              const selected =
                selectedRaw && !Array.isArray(selectedRaw)
                  ? (selectedRaw as Record<string, unknown>)
                  : {};
              const exclusions = parseJsonField(
                (row as { exclusions_json?: string }).exclusions_json,
              );
              const entries = Array.isArray(selected.entries)
                ? (selected.entries as Array<{ source?: string; tokens?: number }>)
                : [];
              const omitted = Array.isArray(selected.omitted)
                ? (selected.omitted as Array<{ id?: string; reason?: string }>)
                : [];
              return (
                <article className="evidence-item" key={String((row as { id?: string }).id ?? index)}>
                  <p>
                    <span>role</span> {String(selected.role ?? '—')}
                  </p>
                  <p>
                    <span>tokens</span> {String(selected.totalTokens ?? '—')} ·{' '}
                    <span>bytes</span> {String(selected.totalBytes ?? '—')}
                  </p>
                  <p>
                    <span>sources</span>{' '}
                    {entries.length
                      ? entries
                          .map((entry) => `${entry.source ?? '?'} (${entry.tokens ?? 0} tok)`)
                          .join(' · ')
                      : '—'}
                  </p>
                  <p>
                    <span>omitted</span>{' '}
                    {omitted.length
                      ? omitted.map((item) => `${item.id}: ${item.reason}`).join(' · ')
                      : 'none'}
                  </p>
                  <p>
                    <span>exclusions</span>{' '}
                    {Array.isArray(exclusions) ? exclusions.join(', ') : formatValue(exclusions)}
                  </p>
                </article>
              );
            })
          ) : (
            <Empty message="No disclosure manifests yet. Start a task to compile context." />
          )}
        </section>
        <details className="raw-json">
          <summary>Raw JSON</summary>
          <pre>{JSON.stringify({ evidence: data, usage }, null, 2)}</pre>
        </details>
      </Section>
    </Shell>
  );
}

function Privacy() {
  const { data: privacy } = useData<{
    localOnly: boolean;
    claims: string[];
  }>(['privacy'], '/api/privacy');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Shell>
      <Section title="Privacy & local data">
        <p className="lede">
          Everything stays on this machine. Use backup/export when you need a copy; delete wipes
          RoleFlock data only (not your git repos).
        </p>
        <ul className="claim-list">
          {(privacy?.claims ?? []).map((claim) => (
            <li key={claim}>{claim}</li>
          ))}
        </ul>
        <div className="actions">
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setNote('');
              try {
                const result = await api.request<{ backupDir: string }>('/api/data/backup', {
                  method: 'POST',
                });
                setNote(`Backup written to ${result.backupDir}`);
              } catch (error) {
                setNote(error instanceof Error ? error.message : 'Backup failed');
              } finally {
                setBusy(false);
              }
            }}
          >
            Backup local database
          </button>
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setNote('');
              try {
                const payload = await api.request<unknown>('/api/diagnostics/export');
                const blob = new Blob([JSON.stringify(payload, null, 2)], {
                  type: 'application/json',
                });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = 'roleflock-diagnostics.json';
                anchor.click();
                URL.revokeObjectURL(url);
                setNote('Downloaded redacted diagnostics');
              } catch (error) {
                setNote(error instanceof Error ? error.message : 'Diagnostics export failed');
              } finally {
                setBusy(false);
              }
            }}
          >
            Export diagnostics
          </button>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={async () => {
              if (
                !window.confirm(
                  'Delete all local RoleFlock data (database, documents, worktrees)? Repository folders on disk are kept.',
                )
              ) {
                return;
              }
              setBusy(true);
              setNote('');
              try {
                const result = await api.request<{ note?: string }>('/api/data/delete', {
                  method: 'POST',
                  body: JSON.stringify({ confirm: 'DELETE_LOCAL_DATA' }),
                });
                setNote(result.note ?? 'Local data deleted. Restart the daemon.');
              } catch (error) {
                setNote(error instanceof Error ? error.message : 'Delete failed');
              } finally {
                setBusy(false);
              }
            }}
          >
            Delete local data
          </button>
        </div>
        {note ? <p className="hint">{note}</p> : null}
      </Section>
    </Shell>
  );
}

function Providers() {
  const queryClient = useQueryClient();
  const {
    data: providers = [],
    isLoading: providersLoading,
    isFetching: providersFetching,
  } = useQuery({
    queryKey: ['providers'],
    queryFn: () => api.request<Provider[]>('/api/providers'),
    refetchInterval: 15_000,
  });
  const { data: projects = [] } = useData<Project[]>(['projects'], '/api/projects');
  const { data: disclosureGrants = [], refetch: refetchDisclosure } = useData<DisclosureGrant[]>(
    ['disclosure-grants'],
    '/api/disclosure-grants',
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [health, setHealth] = useState<Record<string, string>>({});
  const [authNote, setAuthNote] = useState<Record<string, string>>({});
  const [authBusy, setAuthBusy] = useState<Record<string, boolean>>({});
  const [form, setForm] = useState({
    displayName: '',
    endpoint: '',
    apiKey: '',
    model: '',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [disclosureForm, setDisclosureForm] = useState({
    projectId: '',
    providerConnectionId: '',
  });
  const [disclosureNote, setDisclosureNote] = useState('');
  const [disclosureBusy, setDisclosureBusy] = useState(false);

  async function onRegister(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      await api.request('/api/providers', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setForm({ displayName: '', endpoint: '', apiKey: '', model: '' });
      await queryClient.invalidateQueries({ queryKey: ['providers'] });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Failed to register provider');
    } finally {
      setSaving(false);
    }
  }

  async function runAuth(providerId: string, action: 'login' | 'logout' | 'switch') {
    setAuthBusy((current) => ({ ...current, [providerId]: true }));
    setAuthNote((current) => ({ ...current, [providerId]: `${action}…` }));
    try {
      const result = await api.request<{
        ok: boolean;
        detail: string;
        command?: string;
        launched?: boolean;
      }>(`/api/providers/${providerId}/auth/${action}`, { method: 'POST' });
      setAuthNote((current) => ({
        ...current,
        [providerId]: result.command
          ? `${result.detail}${result.launched ? '' : ` · run: ${result.command}`}`
          : result.detail,
      }));
      await queryClient.invalidateQueries({ queryKey: ['providers'] });
    } catch (error) {
      setAuthNote((current) => ({
        ...current,
        [providerId]: error instanceof Error ? error.message : `${action} failed`,
      }));
    } finally {
      setAuthBusy((current) => ({ ...current, [providerId]: false }));
    }
  }

  const visible = providers.filter((provider) => provider.id !== 'fake');

  return (
    <Shell>
      <Section title="Providers">
        <p className="lede">
          Connect the CLIs RoleFlock will use. Sign in here when asked, then open vendor usage for
          plan limits.
        </p>
        {providersLoading ? (
          <Empty message="Loading providers…" />
        ) : visible.length ? (
          <>
            {providersFetching ? (
              <p className="hint" aria-live="polite">
                Updating providers…
              </p>
            ) : null}
            {visible.map((provider) => {
              const needsLogin =
                Boolean(provider.account) &&
                !provider.account!.loggedIn &&
                provider.account!.supportsLogin;
              const accountLabel = provider.account?.loggedIn
                ? provider.account.email ?? provider.account.label ?? 'Signed in'
                : needsLogin
                  ? 'Not signed in'
                  : provider.account?.label ?? null;
              return (
                <article className="provider-card" key={provider.id}>
                  <div className="row">
                    <div className="provider-meta">
                      <div className="provider-title">
                        <b>{provider.displayName}</b>
                        <StatusPill tone={providerTone(provider)}>
                          {providerStatusLabel(provider)}
                        </StatusPill>
                      </div>
                      {accountLabel ? <small>{accountLabel}</small> : null}
                      {provider.account?.subscriptionType ? (
                        <small>{provider.account.subscriptionType}</small>
                      ) : null}
                      {provider.account?.detail && !expanded[provider.id] ? (
                        <p className="hint truncate">{provider.account.detail}</p>
                      ) : null}
                    </div>
                    <div className="actions compact-actions">
                      {needsLogin ? (
                        <button
                          type="button"
                          disabled={authBusy[provider.id]}
                          onClick={() => void runAuth(provider.id, 'login')}
                        >
                          {authBusy[provider.id] ? 'Opening…' : 'Sign in'}
                        </button>
                      ) : null}
                      {(provider.account?.usageLinks ?? []).map((link) => (
                        <a
                          key={link.id}
                          className="quiet buttonish"
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          title={link.hint}
                        >
                          {link.label}
                        </a>
                      ))}
                      <button
                        type="button"
                        className="quiet"
                        onClick={() =>
                          setExpanded((current) => ({
                            ...current,
                            [provider.id]: !current[provider.id],
                          }))
                        }
                      >
                        {expanded[provider.id] ? 'Hide details' : 'Details'}
                      </button>
                    </div>
                  </div>
                  {provider.localUsage ? (
                    <div className="provider-usage">
                      <p>
                        <span>Local meter</span>
                        {provider.localUsage.entryCount} calls ·{' '}
                        {provider.localUsage.inputTokens + provider.localUsage.outputTokens} tokens ·
                        ${provider.localUsage.actualCostUsd.toFixed(4)}
                      </p>
                    </div>
                  ) : null}
                  {authNote[provider.id] ? <p className="hint">{authNote[provider.id]}</p> : null}
                  {health[provider.id] ? <p className="hint">Health: {health[provider.id]}</p> : null}
                  {expanded[provider.id] ? (
                    <div className="provider-details">
                      {provider.account?.detail ? (
                        <p className="hint">{provider.account.detail}</p>
                      ) : null}
                      <div className="actions compact-actions">
                        {provider.account?.loggedIn && provider.account.supportsSwitch ? (
                          <button
                            type="button"
                            className="quiet"
                            disabled={authBusy[provider.id]}
                            onClick={() => void runAuth(provider.id, 'switch')}
                          >
                            Switch account
                          </button>
                        ) : null}
                        {provider.account?.loggedIn && provider.account.supportsLogin ? (
                          <button
                            type="button"
                            className="quiet"
                            disabled={authBusy[provider.id]}
                            onClick={() => void runAuth(provider.id, 'logout')}
                          >
                            Sign out
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="quiet"
                          onClick={async () => {
                            setHealth((current) => ({ ...current, [provider.id]: 'Checking…' }));
                            try {
                              const result = await api.request<{
                                healthy: boolean;
                                status: string;
                                detail?: string;
                              }>(`/api/providers/${provider.id}/health-check`, { method: 'POST' });
                              setHealth((current) => ({
                                ...current,
                                [provider.id]: result.detail
                                  ? `${result.status}: ${result.detail}`
                                  : result.status,
                              }));
                              await queryClient.invalidateQueries({ queryKey: ['providers'] });
                            } catch (error) {
                              setHealth((current) => ({
                                ...current,
                                [provider.id]:
                                  error instanceof Error ? error.message : 'Health check failed',
                              }));
                            }
                          }}
                        >
                          Check health
                        </button>
                      </div>
                      <div className="capabilities">
                        {Object.entries(provider.capabilities).map(([name, enabled]) => (
                          <span
                            key={name}
                            className={enabled ? 'capability enabled' : 'capability'}
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                      <ProviderModels providerId={provider.id} />
                    </div>
                  ) : null}
                </article>
              );
            })}
          </>
        ) : (
          <Empty message="No providers found. Install Claude, Codex, or Cursor Agent CLI, then refresh." />
        )}
      </Section>
      <details className="advanced-panel">
        <summary>Add custom provider or disclosure allow-list</summary>
      <Section title="Add OpenAI-compatible provider">
        <p className="lede">
          Optional. Point RoleFlock at a local or remote OpenAI-compatible endpoint for reviewer.
        </p>
        <form className="stack" onSubmit={(event) => void onRegister(event)}>
          <label className="field-label" htmlFor="provider-name">
            Display name
          </label>
          <input
            id="provider-name"
            required
            placeholder="Local OpenAI-compatible"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
          <label className="field-label" htmlFor="provider-endpoint">
            Endpoint
          </label>
          <input
            id="provider-endpoint"
            required
            placeholder="http://127.0.0.1:11434/v1"
            value={form.endpoint}
            onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
          />
          <label className="field-label" htmlFor="provider-model">
            Model
          </label>
          <input
            id="provider-model"
            required
            placeholder="gpt-4o-mini"
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
          />
          <label className="field-label" htmlFor="provider-key">
            API key
          </label>
          <input
            id="provider-key"
            type="password"
            placeholder="Optional for local endpoints"
            value={form.apiKey}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
          />
          {formError ? <p className="error">{formError}</p> : null}
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Register provider'}
          </button>
        </form>
      </Section>
      <Section title="Allow provider access to briefs">
        <p className="lede">
          Let a provider receive task briefs and attached docs for one project.
        </p>
        <form
          className="stack"
          onSubmit={async (event: FormEvent) => {
            event.preventDefault();
            setDisclosureNote('');
            setDisclosureBusy(true);
            try {
              await api.request('/api/disclosure-grants', {
                method: 'POST',
                body: JSON.stringify({
                  projectId: disclosureForm.projectId,
                  providerConnectionId: disclosureForm.providerConnectionId,
                  scope: { taskBrief: true, documents: true },
                }),
              });
              setDisclosureNote('Access allowed.');
              setDisclosureForm({ projectId: '', providerConnectionId: '' });
              void refetchDisclosure();
            } catch (error) {
              setDisclosureNote(
                error instanceof Error ? error.message : 'Failed to create disclosure grant',
              );
            } finally {
              setDisclosureBusy(false);
            }
          }}
        >
          <label className="field-label" htmlFor="disclosure-project">
            Project
          </label>
          <select
            id="disclosure-project"
            required
            value={disclosureForm.projectId}
            onChange={(e) => setDisclosureForm({ ...disclosureForm, projectId: e.target.value })}
          >
            <option value="">Choose a project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          <label className="field-label" htmlFor="disclosure-provider">
            Provider
          </label>
          <select
            id="disclosure-provider"
            required
            value={disclosureForm.providerConnectionId}
            onChange={(e) =>
              setDisclosureForm({ ...disclosureForm, providerConnectionId: e.target.value })
            }
          >
            <option value="">Choose a provider</option>
            {visible.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.displayName}
              </option>
            ))}
          </select>
          <button type="submit" disabled={disclosureBusy}>
            {disclosureBusy ? 'Saving…' : 'Allow briefs + docs'}
          </button>
          {disclosureNote ? <p className="hint">{disclosureNote}</p> : null}
        </form>
        {disclosureGrants.filter((grant) => !grant.revokedAt).length ? (
          disclosureGrants
            .filter((grant) => !grant.revokedAt)
            .map((grant) => {
              const projectName =
                projects.find((project) => project.id === grant.projectId)?.name ??
                grant.projectId.slice(0, 8);
              const providerName =
                visible.find((provider) => provider.id === grant.providerConnectionId)
                  ?.displayName ?? grant.providerConnectionId;
              return (
              <article className="row" key={grant.id}>
                <div>
                  <b>{providerName}</b>
                  <small>{projectName}</small>
                </div>
                <button
                  type="button"
                  className="quiet"
                  onClick={async () => {
                    await api.request(`/api/disclosure-grants/${grant.id}/revoke`, {
                      method: 'POST',
                    });
                    void refetchDisclosure();
                  }}
                >
                  Revoke
                </button>
              </article>
              );
            })
        ) : (
          <Empty message="No allow-list entries yet." />
        )}
      </Section>
      </details>
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

function parseJsonField(value: unknown): Record<string, unknown> | unknown[] | Record<string, never> {
  if (typeof value !== 'string') {
    return (value as Record<string, unknown> | unknown[] | undefined) ?? {};
  }
  try {
    return JSON.parse(value) as Record<string, unknown> | unknown[];
  } catch {
    return {};
  }
}

function formatUsage(usage: Record<string, unknown>): string {
  const actual = Number(usage.actualCostUsd ?? usage.actual_cost_usd ?? 0);
  const shadow = Number(usage.shadowCostUsd ?? usage.shadow_cost_usd ?? 0);
  return `$${actual.toFixed(4)} actual · $${shadow.toFixed(4)} shadow`;
}

function TaskCard({ task }: { task: Task }) {
  return (
    <Link className="row task" to={`/tasks/${task.id}`}>
      <div>
        <b>{task.title}</b>
        <small>
          {task.type.replaceAll('_', ' ')} · {formatTaskState(task.state)}
        </small>
      </div>
      <StatusPill tone={taskStateTone(task.state)}>{formatTaskState(task.state)}</StatusPill>
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
  const [privacyAccepted, setPrivacyAccepted] = useState(
    () => localStorage.getItem('roleflock-privacy-accepted') === '1',
  );
  const { data: privacy } = useData<{ claims: string[] }>(
    ['privacy-onboarding'],
    '/api/privacy',
    !privacyAccepted,
  );

  if (!privacyAccepted) {
    return (
      <Shell>
        <Section title="Before you start">
          <p className="lede">
            RoleFlock stays on your machine. Confirm these points, then add a project and create a
            task.
          </p>
          <ul className="claim-list">
            {(privacy?.claims ?? [
              'Daemon binds to 127.0.0.1 by default.',
              'Exports redact API keys and tokens.',
              'Update checks do not send repository contents.',
            ]).map((claim) => (
              <li key={claim}>{claim}</li>
            ))}
          </ul>
          <div className="form-actions">
            <button
              type="button"
              onClick={() => {
                localStorage.setItem('roleflock-privacy-accepted', '1');
                setPrivacyAccepted(true);
              }}
            >
              Continue
            </button>
          </div>
        </Section>
      </Shell>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/projects" element={<Projects />} />
      <Route path="/tasks/new" element={<NewTask />} />
      <Route path="/tasks/:id" element={<TaskDetail />} />
      <Route path="/tasks/:id/evidence" element={<Evidence />} />
      <Route path="/approvals" element={<Approvals />} />
      <Route path="/knowledge" element={<Knowledge />} />
      <Route path="/providers" element={<Providers />} />
      <Route path="/privacy" element={<Privacy />} />
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
