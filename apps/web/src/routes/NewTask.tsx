import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Shell } from '../components/Shell.js';
import { Empty, Section } from '../components/primitives.js';
import { api, useData } from '../lib/client.js';
import type { Project, Task, Workflow } from '../types.js';

const DOCUMENT_KINDS = [
  ['prd', 'PRD'],
  ['implementation_plan', 'Implementation plan'],
  ['architecture', 'Architecture'],
  ['api_spec', 'API spec'],
  ['ticket', 'Ticket'],
  ['research', 'Research'],
  ['other', 'Other'],
] as const;

const DOCUMENT_AUTHORITIES = [
  ['authoritative_requirement', 'Authoritative requirement'],
  ['approved_plan', 'Approved plan'],
  ['reference', 'Reference'],
  ['inspiration_only', 'Inspiration only'],
] as const;

const FALLBACK_INTENTS = [
  { id: 'bug_fix', label: 'Fix a Bug', description: '' },
  { id: 'feature', label: 'Add a Feature', description: '' },
  { id: 'investigation', label: 'Investigate', description: '' },
];

const FALLBACK_WORKFLOWS: Workflow[] = [
  { id: 'bug_fix', label: 'Verified Bug Fix', description: '' },
  { id: 'direct', label: 'Direct', description: '' },
  { id: 'fast', label: 'Fast', description: '' },
  { id: 'standard', label: 'Standard', description: '' },
  { id: 'critical', label: 'Critical Feature', description: '' },
];

export function NewTask() {
  const { data: projects = [] } = useData<Project[]>(['projects'], '/api/projects');
  const { data: workflows = [] } = useData<Workflow[]>(['workflows'], '/api/workflows');
  const { data: intents = [] } = useData<Array<{ id: string; label: string; description: string }>>(
    ['task-intents'],
    '/api/task-intents',
  );
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [modeOverride, setModeOverride] = useState<string | null>(null);
  const [pendingDocs, setPendingDocs] = useState<
    Array<{ fileName: string; kind: string; authority: string; content: string }>
  >([]);
  const [docDraft, setDocDraft] = useState({ kind: 'prd', authority: 'reference' });
  const [projectOverride, setProjectOverride] = useState<string | null>(null);
  const [form, setForm] = useState({
    type: 'bug_fix',
    risk: 'medium',
    title: '',
    brief: '',
    expectedBehaviour: '',
    actualBehaviour: '',
    verificationCommand: '',
    maxAttempts: 3,
    maxActualCostUsd: 1,
  });

  const { data: recommendation } = useData<{ mode: string; rationale: string; label: string }>(
    ['workflow-recommend', form.type, form.risk],
    `/api/workflows/recommend?type=${encodeURIComponent(form.type)}&risk=${encodeURIComponent(form.risk)}`,
  );

  // Derived, not synchronised through an effect: the recommendation is the
  // default and an explicit choice overrides it until the intent changes.
  const projectId = projectOverride ?? projects[0]?.id ?? '';
  const mode = modeOverride ?? recommendation?.mode ?? 'bug_fix';
  const overridden = modeOverride !== null && modeOverride !== recommendation?.mode;
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
                    projectId,
                    type: form.type,
                    risk: form.risk,
                    title: form.title,
                    brief: form.brief,
                    expectedBehaviour: form.expectedBehaviour || undefined,
                    actualBehaviour: form.actualBehaviour || undefined,
                    verificationCommand: form.verificationCommand || undefined,
                    mode,
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
              value={projectId}
              onChange={(e) => setProjectOverride(e.target.value)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>

            <fieldset className="intent-fieldset">
              <legend className="field-label">What are you working on?</legend>
              <div className="intent-grid">
                {(intents.length ? intents : FALLBACK_INTENTS).map((intent) => (
                  <button
                    key={intent.id}
                    type="button"
                    aria-pressed={form.type === intent.id}
                    className={form.type === intent.id ? 'intent selected' : 'intent'}
                    onClick={() => {
                      setModeOverride(null);
                      setForm({ ...form, type: intent.id });
                    }}
                  >
                    <strong>{intent.label}</strong>
                    {intent.description ? <small>{intent.description}</small> : null}
                  </button>
                ))}
              </div>
            </fieldset>

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
                      overridden ? ' (overridden)' : ''
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
                  setModeOverride(null);
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
                value={mode}
                onChange={(e) => setModeOverride(e.target.value)}
              >
                {(workflows.length ? workflows : FALLBACK_WORKFLOWS).map((workflow) => (
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
                Runs in the worktree after the writer. Blank uses <code>npm test</code> when
                present.
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
                    {DOCUMENT_KINDS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
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
                    {DOCUMENT_AUTHORITIES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
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

            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="form-actions">
              <button type="submit" disabled={submitting || !projectId}>
                {submitting ? 'Creating…' : 'Create task'}
              </button>
            </div>
          </form>
        )}
      </Section>
    </Shell>
  );
}
