import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Field, FileDrop } from '../components/Field.js';
import { Select, type SelectOption } from '../components/Select.js';
import { Shell } from '../components/Shell.js';
import { Empty, PageHeader } from '../components/primitives.js';
import { api, useData } from '../lib/client.js';
import { DOCUMENT_AUTHORITIES, DOCUMENT_KINDS, RISK_LEVELS } from '../lib/choices.js';
import type { Project, Task, Workflow } from '../types.js';

const FALLBACK_INTENTS = [
  { id: 'bug_fix', label: 'Fix a Bug', description: 'Verified fix with regression checks' },
  { id: 'feature', label: 'Add a Feature', description: 'Extend an existing codebase' },
  { id: 'investigation', label: 'Investigate', description: 'Diagnose before changing code' },
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

  const projectOptions: SelectOption[] = projects.map((project) => ({
    value: project.id,
    label: project.name,
    description: project.resolvedPath,
  }));

  const workflowOptions: SelectOption[] = (workflows.length ? workflows : FALLBACK_WORKFLOWS).map(
    (workflow) => ({
      value: workflow.id,
      label: workflow.label,
      description:
        workflow.id === recommendation?.mode
          ? `Recommended · ${workflow.description}`
          : workflow.description,
    }),
  );

  return (
    <Shell>
      <PageHeader
        eyebrow="New work"
        title="Create a governed task"
        description="Define the outcome and guardrails. RoleFlock will choose the smallest workflow that can plan, implement, test, and verify it safely."
      >
        <ol className="composer-progress" aria-label="Task creation steps">
          <li className="active">
            <span>1</span> Define work
          </li>
          <li>
            <span>2</span> Set guardrails
          </li>
          <li>
            <span>3</span> Start workflow
          </li>
        </ol>
      </PageHeader>

      {noProjects ? (
        <div className="empty-cta surface-card">
          <Empty message="Add a project first, then come back to create a task." />
          <div className="actions">
            <Link className="buttonish" to="/projects">
              Go to Projects
            </Link>
          </div>
        </div>
      ) : (
        <form
          className="task-form task-composer"
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
          <section className="form-section">
            <div className="form-section-heading">
              <span>01</span>
              <div>
                <h2>Define the outcome</h2>
                <p>Give the flock enough context to plan before anyone writes.</p>
              </div>
            </div>
            <div className="form-section-body">
              <Field label="Project" htmlFor="task-project">
                {({ id }) => (
                  <Select
                    id={id}
                    labelledBy={`${id}-label`}
                    value={projectId}
                    options={projectOptions}
                    onChange={setProjectOverride}
                    required
                  />
                )}
              </Field>

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

              <Field label="Title" htmlFor="task-title">
                {({ id }) => (
                  <input
                    id={id}
                    required
                    placeholder="Short task title"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                  />
                )}
              </Field>

              <Field
                label="Brief"
                htmlFor="task-brief"
                hint="What should the flock fix or build? Be specific about the outcome."
              >
                {({ id, describedBy }) => (
                  <textarea
                    id={id}
                    aria-describedby={describedBy}
                    className="compact"
                    required
                    placeholder="Describe the work"
                    value={form.brief}
                    onChange={(e) => setForm({ ...form, brief: e.target.value })}
                  />
                )}
              </Field>

              {form.type === 'bug_fix' ? (
                <div className="two-col">
                  <Field label="Expected" htmlFor="task-expected" optional>
                    {({ id }) => (
                      <textarea
                        id={id}
                        className="compact"
                        placeholder="What should happen?"
                        value={form.expectedBehaviour}
                        onChange={(e) => setForm({ ...form, expectedBehaviour: e.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="Actual" htmlFor="task-actual" optional>
                    {({ id }) => (
                      <textarea
                        id={id}
                        className="compact"
                        placeholder="What happens instead?"
                        value={form.actualBehaviour}
                        onChange={(e) => setForm({ ...form, actualBehaviour: e.target.value })}
                      />
                    )}
                  </Field>
                </div>
              ) : null}
            </div>
          </section>

          <section className="form-section">
            <div className="form-section-heading">
              <span>02</span>
              <div>
                <h2>Review the guardrails</h2>
                <p>Workflow, risk, verification, attempts, and budget stay explicit.</p>
              </div>
            </div>
            <div className="form-section-body">
              <div className="workflow-recommendation">
                <span className="recommendation-mark" aria-hidden="true">
                  ◇
                </span>
                <div>
                  <strong>{recommendation?.label ?? 'Choosing workflow…'}</strong>
                  <p>
                    {recommendation?.rationale ??
                      'RoleFlock is matching the workflow to your intent and risk.'}
                  </p>
                </div>
                <span className="status-pill ok">Recommended</span>
              </div>
              <details className="advanced-panel">
                <summary>Customize guardrails</summary>

                <div className="stack">
                  <p className="hint">
                    {recommendation
                      ? `Suggested workflow: ${recommendation.label}. ${recommendation.rationale}${
                          overridden ? ' (overridden)' : ''
                        }`
                      : 'Leave defaults unless you need a heavier path or custom verification.'}
                  </p>

                  <div className="two-col">
                    <Field
                      label="Risk"
                      htmlFor="task-risk"
                      hint="Raising risk selects a heavier workflow."
                    >
                      {({ id, describedBy }) => (
                        <Select
                          id={id}
                          labelledBy={`${id}-label`}
                          describedBy={describedBy}
                          value={form.risk}
                          options={RISK_LEVELS}
                          onChange={(risk) => {
                            setModeOverride(null);
                            setForm({ ...form, risk });
                          }}
                        />
                      )}
                    </Field>

                    <Field label="Workflow" htmlFor="workflow-mode">
                      {({ id }) => (
                        <Select
                          id={id}
                          labelledBy={`${id}-label`}
                          value={mode}
                          options={workflowOptions}
                          onChange={setModeOverride}
                        />
                      )}
                    </Field>
                  </div>

                  <Field
                    label="Verification command"
                    htmlFor="task-verify"
                    optional
                    hint="Runs in the worktree after the writer. Blank uses npm test when present."
                  >
                    {({ id, describedBy }) => (
                      <input
                        id={id}
                        aria-describedby={describedBy}
                        placeholder="e.g. npm test"
                        value={form.verificationCommand}
                        onChange={(e) => setForm({ ...form, verificationCommand: e.target.value })}
                      />
                    )}
                  </Field>

                  <div className="two-col">
                    <Field label="Max attempts" htmlFor="task-attempts">
                      {({ id }) => (
                        <input
                          id={id}
                          type="number"
                          min={1}
                          value={form.maxAttempts}
                          onChange={(e) =>
                            setForm({ ...form, maxAttempts: Number(e.target.value) })
                          }
                        />
                      )}
                    </Field>
                    <Field
                      label="Max cost (USD)"
                      htmlFor="task-budget"
                      hint="A hard stop on actual spend, not an estimate."
                    >
                      {({ id, describedBy }) => (
                        <input
                          id={id}
                          aria-describedby={describedBy}
                          type="number"
                          min={0}
                          step={0.01}
                          value={form.maxActualCostUsd}
                          onChange={(e) =>
                            setForm({ ...form, maxActualCostUsd: Number(e.target.value) })
                          }
                        />
                      )}
                    </Field>
                  </div>

                  <p className="field-label">Supporting documents</p>
                  <p className="field-hint">Optional. Stored locally with a hash.</p>
                  <div className="two-col">
                    <Field label="Kind" htmlFor="doc-kind">
                      {({ id }) => (
                        <Select
                          id={id}
                          labelledBy={`${id}-label`}
                          value={docDraft.kind}
                          options={DOCUMENT_KINDS}
                          onChange={(kind) => setDocDraft({ ...docDraft, kind })}
                        />
                      )}
                    </Field>
                    <Field label="Authority" htmlFor="doc-authority">
                      {({ id }) => (
                        <Select
                          id={id}
                          labelledBy={`${id}-label`}
                          value={docDraft.authority}
                          options={DOCUMENT_AUTHORITIES}
                          onChange={(authority) => setDocDraft({ ...docDraft, authority })}
                        />
                      )}
                    </Field>
                  </div>

                  <FileDrop
                    id="doc-file"
                    accept=".md,.txt,.json,.yaml,.yml,.csv"
                    label="Attach a text file"
                    hint="drag it here or click to browse"
                    onFile={async (file) => {
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
                    }}
                  />

                  {pendingDocs.length ? (
                    <ul className="doc-list">
                      {pendingDocs.map((doc, index) => (
                        <li key={`${doc.fileName}-${index}`}>
                          <div>
                            <b>{doc.fileName}</b>
                            <small>
                              {doc.kind} · {doc.authority}
                            </small>
                          </div>
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
                </div>
              </details>
            </div>
          </section>

          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="form-actions">
            <div className="launch-note">
              <span aria-hidden="true">✓</span>
              <p>
                Creates an isolated task. No repository file changes until the governed writer stage
                is reached.
              </p>
            </div>
            <button type="submit" disabled={submitting || !projectId}>
              {submitting ? 'Creating task…' : 'Create governed task'}
            </button>
          </div>
        </form>
      )}
    </Shell>
  );
}
