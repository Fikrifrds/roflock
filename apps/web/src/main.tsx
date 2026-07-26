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
  maxActualCostUsd?: number;
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
            <span>Local usage</span>
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
                  projectId: form.projectId,
                  type: form.type,
                  risk: form.risk,
                  title: form.title,
                  brief: form.brief,
                  expectedBehaviour: form.expectedBehaviour || undefined,
                  actualBehaviour: form.actualBehaviour || undefined,
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
            <option value="">Choose a project</option>
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
            Workflow mode
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
          <small className="hint">
            {recommendation
              ? `Recommended: ${recommendation.label}. ${recommendation.rationale}${
                  modeTouched && form.mode !== recommendation.mode ? ' (overridden)' : ''
                }`
              : workflows.find((workflow) => workflow.id === form.mode)?.description ??
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
          {form.type === 'bug_fix' ? (
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
          ) : null}
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
                Max actual cost (USD)
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
          <p className="field-label">Supporting documents (optional)</p>
          <small className="hint">
            Original files are stored locally with SHA-256 hashes. A task can start with none.
          </small>
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
                  {doc.fileName} · {doc.kind} · {doc.authority}
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
        <article className="documents-panel">
          <p className="eyebrow">SUPPORTING DOCUMENTS</p>
          {taskDocuments.length ? (
            <ul className="doc-list">
              {taskDocuments.map((doc) => (
                <li key={doc.id}>
                  <div>
                    <b>{doc.fileName}</b>
                    <small>
                      {doc.kind} · {doc.authority} · sha256 {doc.sha256.slice(0, 12)}…
                    </small>
                    {doc.extractedTextPreview ? (
                      <small>{doc.extractedTextPreview}</small>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">No documents attached. Optional — tasks can start without them.</p>
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
        </article>
        {workflow ? (
          <ol className="workflow-steps" aria-label="Workflow graph">
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
                  'Actual cost',
                  `$${(execution?.actualCost ?? 0).toFixed(4)}`,
                ],
                [
                  'Shadow cost',
                  `$${(execution?.shadowCost ?? 0).toFixed(4)} (not a bill)`,
                ],
                [
                  'Budget remaining',
                  task.maxActualCostUsd === undefined
                    ? 'No hard cap'
                    : `$${Math.max(0, task.maxActualCostUsd - (execution?.actualCost ?? 0)).toFixed(4)} of $${task.maxActualCostUsd.toFixed(4)}`,
                ],
                ['Usage confidence', execution?.usageConfidence ?? 'exact'],
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

function Providers() {
  const queryClient = useQueryClient();
  const { data: providers = [] } = useData<Provider[]>(['providers'], '/api/providers');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [health, setHealth] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    displayName: '',
    endpoint: '',
    apiKey: '',
    model: '',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  return (
    <Shell>
      <Section title="Providers">
        <p className="lede">
          Local CLI discovery plus optional OpenAI-compatible HTTP endpoints. Missing CLIs stay
          listed so you can install them later.
        </p>
        {providers.length ? (
          providers.map((provider) => (
            <article className="provider-card" key={provider.id}>
              <div className="row">
                <div>
                  <b>{provider.displayName}</b>
                  <small>id {provider.id}</small>
                  <small>
                    {provider.connectionType ?? 'cli'} · {provider.status}
                  </small>
                  {provider.health?.detail ? <small>{provider.health.detail}</small> : null}
                </div>
                <div className="actions compact-actions">
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
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((current) => ({
                        ...current,
                        [provider.id]: !current[provider.id],
                      }))
                    }
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
          <Empty message="No providers are configured yet." />
        )}
      </Section>
      <Section title="Add OpenAI-compatible provider">
        <p className="lede">
          Point RoleFlock at any OpenAI-compatible chat completions endpoint for the reviewer
          role.
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
          <div className="form-actions">
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Register provider'}
            </button>
          </div>
        </form>
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
