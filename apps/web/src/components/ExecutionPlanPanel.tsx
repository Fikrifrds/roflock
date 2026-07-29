import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Section, StatusPill } from './primitives.js';
import { api, useData } from '../lib/client.js';
import type { ExecutionPlan, ExecutionPlanResponse, Task } from '../types.js';

export function ExecutionPlanPanel({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const query = useData<ExecutionPlanResponse>(
    ['execution-plan', task.id],
    `/api/tasks/${task.id}/execution-plan`,
  );
  const response =
    query.data?.aggregate !== undefined && query.data.plan !== undefined ? query.data : undefined;
  const plan = response?.plan;
  const [revisionReason, setRevisionReason] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const mutate = async (label: string, operation: () => Promise<unknown>) => {
    setBusy(label);
    setError('');
    try {
      await operation();
      setRevisionReason('');
      await queryClient.invalidateQueries({ queryKey: ['execution-plan', task.id] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Execution Plan action failed');
    } finally {
      setBusy('');
    }
  };

  const approve = () => {
    if (plan === undefined || response === undefined) return;
    return mutate('approve', () =>
      api.request(`/api/execution-plans/${plan.id}/approve`, {
        method: 'POST',
        headers: mutationHeaders(response.aggregate.revision),
      }),
    );
  };

  /**
   * Derives a plan from the authorised contract and proposes it.
   *
   * The draft is fetched rather than assembled here so the boundary the
   * executor will be held to is computed from the repository, not guessed by
   * the browser.
   */
  const proposeFromContract = () =>
    mutate('propose', async () => {
      const draft = (await api.request(`/api/tasks/${task.id}/execution-plan/draft`)) as {
        plan: Record<string, unknown>;
      };
      await api.request(`/api/tasks/${task.id}/execution-plan`, {
        method: 'POST',
        body: JSON.stringify(draft.plan),
      });
    });

  const revise = () => {
    if (plan === undefined || response === undefined || !revisionReason.trim()) return;
    return mutate('revise', () =>
      api.request(`/api/execution-plans/${plan.id}/revisions`, {
        method: 'POST',
        headers: mutationHeaders(response.aggregate.revision),
        body: JSON.stringify({
          ...semanticPlan(plan),
          revisionReason: revisionReason.trim(),
        }),
      }),
    );
  };

  // A settled error means "no plan exists", which is a state to render, not to
  // keep waiting on.
  if (query.isLoading && !query.isError) {
    return (
      <Section title="Execution plan" description="Checking the planner's sealed instructions…">
        <p className="hint">Loading execution plan…</p>
      </Section>
    );
  }

  if (plan === undefined || response === undefined) {
    return (
      <Section
        title="Execution plan"
        description="Planner-owned steps and boundaries that executors must follow exactly."
      >
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <p className="hint">
          No Execution Plan has been proposed for this task, so execution cannot enter assured mode.
          You can propose one derived from the authorised contract — one step per acceptance
          criterion, scoped to the paths this repository tracks — then review and approve it below.
        </p>
        <div className="actions">
          <button type="button" disabled={busy !== ''} onClick={() => void proposeFromContract()}>
            {busy === 'propose' ? 'Proposing…' : 'Propose plan from contract'}
          </button>
        </div>
      </Section>
    );
  }

  return (
    <Section
      title="Execution plan"
      description="Sealed planner instructions. Executors receive this exact hash and may not reinterpret its scope."
      className="execution-plan-panel"
      actions={
        <div className="contract-status-row">
          <StatusPill tone={statusTone(plan.status)}>{plan.status}</StatusPill>
          <span>
            v{plan.version} · revision {response.aggregate.revision}
          </span>
        </div>
      }
    >
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {response.collisions && response.collisions.length > 0 ? (
        <div className="plan-collision-warning" role="alert">
          <strong>Expected path overlap with active work</strong>
          <p>
            This is a conservative preflight warning, not proof of a merge conflict. Review the
            overlapping plan hashes before running both writers.
          </p>
          <ul>
            {response.collisions.map((collision) => (
              <li key={`${collision.taskId}-${collision.path}-${collision.conflictingPath}`}>
                <code>{collision.path}</code> overlaps <code>{collision.conflictingPath}</code> in
                task {collision.taskId} · plan {shortHash(collision.planHash)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="plan-seal">
        <div>
          <span className="eyebrow">PLAN HASH</span>
          <code title={plan.hash}>{shortHash(plan.hash)}</code>
        </div>
        <div>
          <span className="eyebrow">CONTRACT HASH</span>
          <code title={plan.contractHash}>{shortHash(plan.contractHash)}</code>
        </div>
        <div>
          <span className="eyebrow">VERIFICATION</span>
          <strong>{plan.verificationSpecId}</strong>
        </div>
      </div>

      <div className="plan-summary">
        <span className="eyebrow">PLANNER SUMMARY</span>
        <p>{plan.summary}</p>
        <p className="hint">
          Proposed by {plan.proposedBy.providerId}/{plan.proposedBy.modelId} · invocation{' '}
          {plan.proposedBy.invocationId}
        </p>
      </div>

      <div className="plan-grid">
        <div>
          <h3>Boundaries</h3>
          <PathList label="Allowed" paths={plan.allowedPaths} />
          <PathList label="Expected changes" paths={plan.expectedChangedPaths} />
          <PathList label="Forbidden" paths={plan.forbiddenPaths} empty="None declared" />
        </div>
        <div>
          <h3>Change budget</h3>
          <dl className="plan-budget">
            <div>
              <dt>Files</dt>
              <dd>{plan.changeBudget.maxChangedFiles}</dd>
            </div>
            <div>
              <dt>Added lines</dt>
              <dd>{plan.changeBudget.maxAddedLines}</dd>
            </div>
            <div>
              <dt>Deleted lines</dt>
              <dd>{plan.changeBudget.maxDeletedLines}</dd>
            </div>
            <div>
              <dt>Dependencies</dt>
              <dd>{plan.changeBudget.maxNewDependencies}</dd>
            </div>
          </dl>
        </div>
      </div>

      <div>
        <h3>Approved steps</h3>
        <div className="plan-step-list">
          {plan.steps.map((step, index) => (
            <article className="plan-step" key={step.id}>
              <span className="plan-step-number">{index + 1}</span>
              <div>
                <strong>
                  {step.id}: {step.objective}
                </strong>
                <p className="hint">
                  Criteria {step.criterionIds.join(', ')} · evidence{' '}
                  {step.completionEvidenceIds.join(', ')}
                </p>
                <p>
                  {step.allowedOperations.join(' · ')}
                  {step.expectedFiles.length > 0 ? ` — ${step.expectedFiles.join(', ')}` : ''}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>

      <div>
        <h3>Deviation register</h3>
        {response.deviations.length === 0 ? (
          <p className="hint">No deviations have been recorded against this plan.</p>
        ) : (
          <div className="plan-deviation-list">
            {response.deviations.map((deviation) => (
              <article className="plan-deviation" key={deviation.id}>
                <StatusPill tone={deviation.status === 'open' ? 'warn' : 'muted'}>
                  {deviation.status.replaceAll('_', ' ')}
                </StatusPill>
                <strong>{deviation.type.replaceAll('_', ' ')}</strong>
                <span className="hint">
                  detected by {deviation.detectedBy} · bound to {shortHash(deviation.planHash)}
                </span>
                {deviation.proposedOptions.map((option) => (
                  <p key={option}>{option}</p>
                ))}
              </article>
            ))}
          </div>
        )}
      </div>

      {plan.revisionReason ? (
        <p className="plan-lineage">
          <strong>Revision reason:</strong> {plan.revisionReason}
        </p>
      ) : null}

      <div className="plan-actions">
        {plan.status === 'proposed' ? (
          <button type="button" onClick={() => void approve()} disabled={Boolean(busy)}>
            {busy === 'approve' ? 'Approving…' : 'Approve execution plan'}
          </button>
        ) : null}
        <label className="plan-revision-field">
          Planner revision reason
          <textarea
            value={revisionReason}
            onChange={(event) => setRevisionReason(event.target.value)}
            rows={2}
            placeholder="Explain the deviation or authority change that requires a new plan."
          />
        </label>
        <button
          type="button"
          className="quiet"
          onClick={() => void revise()}
          disabled={Boolean(busy) || !revisionReason.trim()}
        >
          {busy === 'revise' ? 'Creating revision…' : 'Create plan revision'}
        </button>
      </div>

      <details className="plan-history">
        <summary>Immutable history ({response.snapshots?.length ?? 1} snapshots)</summary>
        <ol>
          {(response.snapshots ?? [plan]).map((snapshot) => (
            <li key={`${snapshot.version}-${snapshot.hash}`}>
              v{snapshot.version} · {snapshot.status} · <code>{shortHash(snapshot.hash)}</code>
            </li>
          ))}
        </ol>
      </details>
    </Section>
  );
}

function PathList({
  label,
  paths,
  empty = 'None',
}: {
  label: string;
  paths: string[];
  empty?: string;
}) {
  return (
    <div className="plan-path-group">
      <span className="eyebrow">{label}</span>
      <p>{paths.length > 0 ? paths.join(', ') : empty}</p>
    </div>
  );
}

function semanticPlan(plan: ExecutionPlan) {
  return {
    summary: plan.summary,
    assumptions: plan.assumptions,
    steps: plan.steps,
    allowedPaths: plan.allowedPaths,
    expectedChangedPaths: plan.expectedChangedPaths,
    forbiddenPaths: plan.forbiddenPaths,
    dependencyChanges: plan.dependencyChanges,
    migrationActions: plan.migrationActions,
    verificationSpecId: plan.verificationSpecId,
    repairEnvelope: plan.repairEnvelope,
    changeBudget: plan.changeBudget,
    decisionLog: plan.decisionLog,
  };
}

function mutationHeaders(revision: number): Record<string, string> {
  return {
    'content-type': 'application/json',
    'if-match': `"${revision}"`,
    'x-roleflock-actor-id': 'local-user',
    'x-roleflock-invocation-id': `planner-ui-${crypto.randomUUID()}`,
    'x-roleflock-provider-id': 'roleflock-ui',
    'x-roleflock-model-id': 'human-directed-revision',
  };
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

function statusTone(status: ExecutionPlan['status']): 'ok' | 'warn' | 'muted' {
  if (status === 'approved') return 'ok';
  if (status === 'proposed') return 'warn';
  return 'muted';
}
