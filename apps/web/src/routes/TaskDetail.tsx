import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Field, FileDrop } from '../components/Field.js';
import { BlockedBanner } from '../components/BlockedBanner.js';
import { GraphRunView } from '../components/GraphRunView.js';
import { LiveTurn } from '../components/LiveTurn.js';
import { TaskJourney } from '../components/TaskJourney.js';
import { WorkspaceChanges } from '../components/WorkspaceChanges.js';
import { Select } from '../components/Select.js';
import { Shell } from '../components/Shell.js';
import { Empty, Section, StatusPill } from '../components/primitives.js';
import { api, useData } from '../lib/client.js';
import { DOCUMENT_AUTHORITIES, DOCUMENT_KINDS } from '../lib/choices.js';
import { formatPhase, formatTaskState, isTerminalState, taskStateTone } from '../lib/format.js';
import type {
  ActiveExecution,
  Approval,
  GraphRunView as GraphRunViewData,
  Task,
  TaskDocument,
} from '../types.js';

export function TaskDetail() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const [actionError, setActionError] = useState('');
  const [starting, setStarting] = useState(false);
  const [verificationDraft, setVerificationDraft] = useState('');
  const [savingVerification, setSavingVerification] = useState(false);
  const [docDraft, setDocDraft] = useState({ kind: 'prd', authority: 'reference' });
  const [workspaceView, setWorkspaceView] = useState<'workflow' | 'changes'>('workflow');

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
  const { data: taskDocuments = [] } = useData<TaskDocument[]>(
    ['task-documents', id],
    `/api/tasks/${id}/documents`,
    Boolean(id),
  );
  const { data: runView } = useData<GraphRunViewData>(
    ['task-graph', id],
    `/api/tasks/${id}/graph`,
    Boolean(id),
  );
  const { data: evidence } = useData<{
    findings?: Array<{ severity: string; summary: string; details?: string }>;
  }>(['evidence', id], `/api/evidence/tasks/${id}`, Boolean(id));
  const { data: verificationSuggestion } = useData<{ command?: string }>(
    ['verification-suggestion', id],
    `/api/tasks/${id}/verification-suggestion`,
    Boolean(id && task?.state === 'failed' && !task.verificationCommand),
  );

  if (!task) {
    return (
      <Shell>
        <Empty message="Loading task…" />
      </Shell>
    );
  }

  const refresh = () => {
    for (const queryKey of [
      ['task', id],
      ['execution', id],
      ['task-approvals', id],
      ['approvals'],
      ['evidence', id],
      ['task-documents', id],
      ['task-graph', id],
      ['verification-suggestion', id],
    ]) {
      void qc.invalidateQueries({ queryKey });
    }
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

  const finished = isTerminalState(task.state);
  // Only worth showing while the task is stopped; a run that has moved on has
  // already resolved it.
  const blocked = task.state === 'failed' ? (runView?.blocked ?? null) : null;
  const waiting =
    task.state === 'awaiting_confirmation' ||
    task.state === 'awaiting_acceptance' ||
    pending.length > 0;
  const latestError =
    task.state === 'failed' || task.state === 'cancelled'
      ? [...(evidence?.findings ?? [])].reverse().find((finding) => finding.severity === 'error')
      : undefined;
  const verificationMissing = Boolean(
    task.state === 'failed' &&
    (latestError?.summary.includes('Verification command required') ||
      latestError?.details?.includes('missing-verification-command') ||
      latestError?.details?.includes('No verification command')),
  );
  const suggestedCommand = verificationSuggestion?.command ?? task.verificationCommand ?? '';
  const verificationCommand = verificationDraft || suggestedCommand;
  const graphNodes = runView?.graph.nodes ?? [];
  const completedGraphNodes = graphNodes.filter((node) => node.state === 'completed').length;
  const activeGraphNode = graphNodes.find((node) => node.state === 'running');
  const saveVerificationAndRetry = async () => {
    if (!verificationCommand.trim()) return;
    setActionError('');
    setSavingVerification(true);
    try {
      await api.request(`/api/tasks/${id}/verification-command`, {
        method: 'PATCH',
        body: JSON.stringify({ verificationCommand }),
      });
      await api.request(`/api/tasks/${id}/start`, { method: 'POST' });
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Unable to save verification command');
      refresh();
    } finally {
      setSavingVerification(false);
    }
  };

  return (
    <Shell>
      <div className="task-workspace-head">
        <div>
          <div className="task-workspace-kicker">
            <p className="eyebrow">Governed task</p>
            <StatusPill tone={taskStateTone(task.state)}>{formatTaskState(task.state)}</StatusPill>
            <span>
              {task.type.replaceAll('_', ' ')} · {task.risk} risk
            </span>
          </div>
          <h1>{task.title}</h1>
          <p className="task-workspace-brief">{task.brief}</p>
        </div>
        <div className="workspace-tabs" role="tablist" aria-label="Task workspace">
          <button
            type="button"
            role="tab"
            aria-selected={workspaceView === 'workflow'}
            className={workspaceView === 'workflow' ? 'active' : ''}
            onClick={() => setWorkspaceView('workflow')}
          >
            Workflow
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={workspaceView === 'changes'}
            className={workspaceView === 'changes' ? 'active' : ''}
            onClick={() => setWorkspaceView('changes')}
          >
            Changes &amp; Git
          </button>
          <Link className="workspace-tab-link" to={`/tasks/${id}/evidence`}>
            Evidence
          </Link>
        </div>
      </div>
      <TaskJourney task={task} runView={runView} />
      {workspaceView === 'changes' ? (
        <WorkspaceChanges task={task} />
      ) : (
        <Section title="Current state" className="task-control-section">
          {actionError || (latestError && !blocked) ? (
            <p className="error" role="alert">
              {actionError || latestError?.details || latestError?.summary}
            </p>
          ) : null}

          {blocked ? (
            <BlockedBanner
              blocked={blocked}
              retrying={starting}
              onRetry={() => void action('start')}
            />
          ) : null}

          {verificationMissing ? (
            <article className="verification-recovery" role="alert">
              <p className="eyebrow">VERIFICATION COMMAND REQUIRED</p>
              <h3>The code change was not tested yet</h3>
              <p className="hint">
                This repository has no configured verification command or Node test script. Choose a
                command below, then RoleFlock will retry from verification without repeating the
                work.
              </p>
              <label>
                Verification command
                <input
                  value={verificationCommand}
                  onChange={(event) => setVerificationDraft(event.target.value)}
                  placeholder="e.g. python3 -m pytest"
                />
              </label>
              {verificationSuggestion?.command ? (
                <button
                  type="button"
                  className="quiet verification-suggestion"
                  onClick={() => setVerificationDraft(verificationSuggestion.command ?? '')}
                >
                  Use detected command: <code>{verificationSuggestion.command}</code>
                </button>
              ) : null}
              <div className="actions">
                <button
                  type="button"
                  disabled={!verificationCommand.trim() || savingVerification}
                  onClick={() => void saveVerificationAndRetry()}
                >
                  {savingVerification
                    ? 'Saving and retrying…'
                    : 'Save command & retry verification'}
                </button>
              </div>
            </article>
          ) : null}

          {pending.length > 0 ? (
            <article
              id="approval-required"
              className="pending-banner"
              role="region"
              aria-label="Decision needed"
            >
              <p className="eyebrow">YOUR DECISION NEEDED</p>
              <h3>Approve to continue, or reject to stop this step</h3>
              {pending.map((approval) => (
                <div key={approval.id} className="pending-item">
                  <p>
                    <b>{approval.requestType.replaceAll('_', ' ')}</b> — {approval.rationale}
                  </p>
                  <div className="actions">
                    <button type="button" onClick={() => void decide(approval.id, 'approve')}>
                      Approve &amp; continue
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
            <article
              id="approval-required"
              className="pending-banner"
              role="region"
              aria-label="Accept the result"
            >
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

          <article className="task-now">
            <div className="task-now-copy">
              <p className="eyebrow">{finished ? 'Outcome' : 'Current activity'}</p>
              <h2 role="status" aria-live="polite">
                {formatPhase(execution?.phase, task.state)}
              </h2>
              <p>
                {finished
                  ? 'This run has finished.'
                  : task.state === 'stopping'
                    ? 'Waiting for the active process to stop safely.'
                    : (execution?.currentActivity ?? 'Idle')}
              </p>
            </div>
            <dl className="task-now-assignment">
              <div>
                <dt>Role</dt>
                <dd>{finished ? '—' : (execution?.roleDisplayName ?? 'Waiting')}</dd>
              </div>
              <div>
                <dt>Provider</dt>
                <dd>{finished ? '—' : (execution?.providerDisplayName ?? '—')}</dd>
              </div>
            </dl>
            <div className="actions task-now-actions">
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
            </div>
          </article>

          <details className="task-run-details">
            <summary>
              <span>Run details</span>
              <small>
                Attempt {execution?.attempt ?? 0}/{task.maxAttempts} · {task.workflowGraphVersionId}
              </small>
            </summary>
            <div className="task-run-details-body">
              <dl>
                {(
                  [
                    ['Activity', finished ? 'Finished' : (execution?.currentActivity ?? 'Idle')],
                    ['Model', execution?.configuredModelDisplayName ?? '—'],
                    ['Effort', execution?.effort ?? 'standard'],
                    ['Permission', execution?.permissionProfileId ?? '—'],
                    ['Command', execution?.activeCommandPreview ?? '—'],
                    ['Heartbeat', execution?.lastHeartbeatAt ?? '—'],
                    ['Actual cost', `$${(execution?.actualCost ?? 0).toFixed(4)}`],
                    [
                      'Budget left',
                      task.maxActualCostUsd === undefined
                        ? 'No hard cap'
                        : `$${Math.max(
                            0,
                            task.maxActualCostUsd - (execution?.actualCost ?? 0),
                          ).toFixed(4)}`,
                    ],
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
            </div>
          </details>

          <LiveTurn
            execution={execution}
            finished={finished}
            awaitingDecision={waiting}
            visible={task.state === 'running' || waiting}
          />

          <details className="workflow-map-panel">
            <summary>
              <div>
                <span className="eyebrow">Workflow map</span>
                <strong>
                  {activeGraphNode
                    ? `${activeGraphNode.id.replaceAll('_', ' ')} in progress`
                    : `${completedGraphNodes} of ${graphNodes.length} steps complete`}
                </strong>
              </div>
              <span>View graph</span>
            </summary>
            <GraphRunView taskId={id} execution={execution} />
          </details>

          {waiting ? (
            <aside className="approval-dock" role="status" aria-live="polite">
              <span className="approval-dock-dot" aria-hidden="true" />
              <div>
                <strong>Action required</strong>
                <small>
                  {pending.length
                    ? `${pending.length} approval${pending.length === 1 ? '' : 's'} waiting for you.`
                    : 'Review the verified result and decide whether to accept it.'}
                </small>
              </div>
              <a className="buttonish" href="#approval-required">
                Review now
              </a>
            </aside>
          ) : null}

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
                      {doc.extractedTextPreview ? <small>{doc.extractedTextPreview}</small> : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">Optional. Attach notes that should inform planning.</p>
            )}
            <div className="two-col">
              <Field label="Kind" htmlFor="detail-doc-kind">
                {({ id: fieldId }) => (
                  <Select
                    id={fieldId}
                    labelledBy={`${fieldId}-label`}
                    value={docDraft.kind}
                    options={DOCUMENT_KINDS}
                    onChange={(kind) => setDocDraft({ ...docDraft, kind })}
                  />
                )}
              </Field>
              <Field label="Authority" htmlFor="detail-doc-authority">
                {({ id: fieldId }) => (
                  <Select
                    id={fieldId}
                    labelledBy={`${fieldId}-label`}
                    value={docDraft.authority}
                    options={DOCUMENT_AUTHORITIES}
                    onChange={(authority) => setDocDraft({ ...docDraft, authority })}
                  />
                )}
              </Field>
            </div>
            <FileDrop
              id="detail-doc-file"
              accept=".md,.txt,.json,.yaml,.yml,.csv"
              label="Attach a text file"
              hint="drag it here or click to browse"
              onFile={async (file) => {
                try {
                  await api.request(`/api/tasks/${id}/documents`, {
                    method: 'POST',
                    body: JSON.stringify({
                      fileName: file.name,
                      kind: docDraft.kind,
                      authority: docDraft.authority,
                      content: await file.text(),
                      mimeType: file.type || 'text/plain',
                    }),
                  });
                  refresh();
                } catch (error) {
                  setActionError(error instanceof Error ? error.message : 'Upload failed');
                }
              }}
            />
          </details>
        </Section>
      )}
    </Shell>
  );
}
