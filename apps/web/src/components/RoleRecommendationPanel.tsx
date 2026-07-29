import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Field } from './Field.js';
import { Select } from './Select.js';
import { Section, StatusPill } from './primitives.js';
import { api, useData } from '../lib/client.js';
import type {
  RecommendedRoleView,
  RoleRecommendationCandidateView,
  StoredRoleRecommendationView,
  Task,
} from '../types.js';

const ROLE_LABELS: Record<RecommendedRoleView, string> = {
  planner: 'Planner',
  plan_critic: 'Plan critic',
  executor: 'Executor',
  verifier: 'Verifier',
};

const ROLE_BOUNDARIES: Record<RecommendedRoleView, string> = {
  planner: 'Owns implementation decisions; cannot write repository files.',
  plan_critic: 'Challenges the plan; cannot rewrite or approve it.',
  executor: 'Must follow the approved plan; ambiguity returns to the planner.',
  verifier: 'Assesses frozen criteria independently; cannot repair the implementation.',
};

export function RoleRecommendationPanel({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const queryKey = ['role-recommendation', task.id];
  const { data, isLoading } = useData<StoredRoleRecommendationView | null>(
    queryKey,
    `/api/tasks/${task.id}/role-recommendations/latest`,
  );
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [overrideDraft, setOverrideDraft] = useState<
    Partial<Record<RecommendedRoleView, { candidateKey: string; reason: string }>>
  >({});

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey });
    await queryClient.invalidateQueries({ queryKey: ['roles'] });
  };

  const generate = async () => {
    setBusy('generate');
    setError('');
    setNote('');
    try {
      await api.request(`/api/tasks/${task.id}/role-recommendations`, {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
      });
      setNote('Role recommendation generated from the current provider state.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate role recommendation');
    } finally {
      setBusy('');
    }
  };

  const applyAll = async () => {
    if (!data) return;
    setBusy('apply');
    setError('');
    setNote('');
    try {
      await api.request(`/api/role-recommendations/${data.recommendation.id}/apply`, {
        method: 'POST',
        headers: {
          'idempotency-key': crypto.randomUUID(),
          'if-match': String(data.revision),
        },
      });
      setNote('Recommended roster applied. Every fallback keeps the same hard constraints.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to apply recommended roster');
    } finally {
      setBusy('');
    }
  };

  const applyOverride = async (role: RecommendedRoleView) => {
    if (!data) return;
    const draft = overrideDraft[role];
    const candidate = draft
      ? candidatesFor(data, role).find(
          (item) => candidateKey(item) === draft.candidateKey && item.eligible,
        )
      : undefined;
    if (!candidate || !draft?.reason.trim()) {
      setError('Choose an eligible model and explain why this task needs the override.');
      return;
    }
    setBusy(role);
    setError('');
    setNote('');
    try {
      await api.request(`/api/role-recommendations/${data.recommendation.id}/override`, {
        method: 'POST',
        headers: {
          'idempotency-key': crypto.randomUUID(),
          'if-match': String(data.revision),
        },
        body: JSON.stringify({
          role,
          providerId: candidate.providerId,
          modelId: candidate.modelId,
          reason: draft.reason.trim(),
        }),
      });
      setOverrideDraft((current) => {
        const next = { ...current };
        delete next[role];
        return next;
      });
      setNote(`${ROLE_LABELS[role]} override applied and recorded.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to apply role override');
    } finally {
      setBusy('');
    }
  };

  if (isLoading) {
    return (
      <Section title="Suggested role roster">
        <p className="hint">Matching available models to role constraints…</p>
      </Section>
    );
  }

  if (!data?.recommendation || !Array.isArray(data.actions)) {
    return (
      <Section
        title="Suggested role roster"
        description="RoleFlock can assign planner, executor, and verifier from versioned capability evidence."
      >
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="recommendation-empty">
          <div>
            <p className="eyebrow">DETERMINISTIC ROLE FIT</p>
            <h3>Choose models by responsibility, not one model for everything</h3>
            <p className="hint">
              Hard capability and independence rules run before scoring. Unknown capability stays
              visible instead of becoming an optimistic default.
            </p>
          </div>
          <button type="button" disabled={busy === 'generate'} onClick={() => void generate()}>
            {busy === 'generate' ? 'Generating…' : 'Suggest role roster'}
          </button>
        </div>
      </Section>
    );
  }

  const recommendation = data.recommendation;
  const lastAction = data.actions.at(-1);
  return (
    <Section
      title="Suggested role roster"
      description={`Profile bundle ${recommendation.profileBundleVersion} · scorer ${recommendation.scoringVersion}`}
    >
      <div className="recommendation-summary">
        <div>
          <p className="eyebrow">ROLE FIT FOR {recommendation.risk.toUpperCase()} RISK</p>
          <h3>
            {recommendation.complete
              ? 'A constraint-valid roster is ready'
              : 'No complete safe roster is currently available'}
          </h3>
          <p className="hint">
            {lastAction
              ? `Revision ${data.revision} · last ${lastAction.action} ${new Date(lastAction.createdAt).toLocaleString()}.`
              : 'Nothing has been applied yet. Review the rationale and fallbacks first.'}
          </p>
        </div>
        <div className="actions">
          <StatusPill tone={recommendation.complete ? 'ok' : 'warn'}>
            {recommendation.complete ? 'Constraints met' : 'Blocked'}
          </StatusPill>
          <button
            type="button"
            disabled={!recommendation.complete || busy === 'apply'}
            onClick={() => void applyAll()}
          >
            {busy === 'apply' ? 'Applying…' : 'Apply recommended roster'}
          </button>
          <button
            type="button"
            className="quiet"
            disabled={busy === 'generate'}
            onClick={() => void generate()}
          >
            Regenerate
          </button>
        </div>
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {note ? (
        <p className="hint" role="status" aria-live="polite">
          {note}
        </p>
      ) : null}
      {recommendation.gaps.length ? (
        <ul className="recommendation-gaps" aria-label="Recommendation gaps">
          {recommendation.gaps.map((gap) => (
            <li key={gap}>{gap}</li>
          ))}
        </ul>
      ) : null}

      <div className="recommendation-role-grid">
        {recommendation.requiredRoles.map((role) => {
          const candidates = candidatesFor(data, role);
          const selected = candidates.find((candidate) => candidate.selected);
          const fallback = candidates.find((candidate) => candidate.fallback);
          const roleIndependence = recommendation.independence.filter(
            (finding) => finding.leftRole === role || finding.rightRole === role,
          );
          const draft = overrideDraft[role] ?? { candidateKey: '', reason: '' };
          const options = candidates
            .filter((candidate) => candidate.eligible && !candidate.selected)
            .map((candidate) => ({
              value: candidateKey(candidate),
              label: `${candidate.providerId} / ${candidate.modelId}`,
              description: `${percent(candidate.score)} fit · ${percent(candidate.confidence)} confidence`,
            }));

          return (
            <article className="recommendation-role-card" key={role}>
              <div className="recommendation-role-head">
                <div>
                  <p className="eyebrow">{ROLE_LABELS[role]}</p>
                  <h3>
                    {selected
                      ? `${selected.providerId} / ${selected.modelId}`
                      : 'No eligible model'}
                  </h3>
                </div>
                {selected ? (
                  <StatusPill tone={confidenceTone(selected.confidence)}>
                    {percent(selected.confidence)} confidence
                  </StatusPill>
                ) : (
                  <StatusPill tone="warn">Unavailable</StatusPill>
                )}
              </div>
              <p className="role-boundary">{ROLE_BOUNDARIES[role]}</p>
              {selected ? (
                <>
                  <dl className="recommendation-metrics">
                    <div>
                      <dt>Fit</dt>
                      <dd>{percent(selected.score)}</dd>
                    </div>
                    <div>
                      <dt>Effort</dt>
                      <dd>{selected.effort}</dd>
                    </div>
                    <div>
                      <dt>Profile</dt>
                      <dd>{selected.profileVersion}</dd>
                    </div>
                  </dl>
                  <ul className="recommendation-reasons">
                    {selected.rationale.slice(0, 2).map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  <p className="recommendation-fallback">
                    <b>Fallback:</b>{' '}
                    {fallback
                      ? `${fallback.providerId} / ${fallback.modelId} — independently revalidated`
                      : 'No constraint-valid fallback is available'}
                  </p>
                  <p className="recommendation-independence">
                    <b>Independence:</b>{' '}
                    {roleIndependence.length
                      ? roleIndependence
                          .map(
                            (finding) =>
                              `${finding.property.replaceAll('_', ' ')} ${finding.satisfied ? 'met' : 'not met'}`,
                          )
                          .join(' · ')
                      : 'dedicated invocation'}
                  </p>
                </>
              ) : null}

              {options.length ? (
                <details className="recommendation-override">
                  <summary>Override this role</summary>
                  <div className="stack">
                    <Field label="Eligible alternative">
                      {({ id }) => (
                        <Select
                          id={id}
                          labelledBy={`${id}-label`}
                          value={draft.candidateKey}
                          options={[
                            {
                              value: '',
                              label: 'Choose a model',
                              description: 'Only constraint-valid candidates are listed',
                            },
                            ...options,
                          ]}
                          onChange={(candidateKey) =>
                            setOverrideDraft((current) => ({
                              ...current,
                              [role]: { ...draft, candidateKey },
                            }))
                          }
                        />
                      )}
                    </Field>
                    <Field label="Override reason">
                      {({ id }) => (
                        <textarea
                          id={id}
                          className="compact"
                          value={draft.reason}
                          placeholder="Why is this alternative better for this task?"
                          onChange={(event) =>
                            setOverrideDraft((current) => ({
                              ...current,
                              [role]: { ...draft, reason: event.target.value },
                            }))
                          }
                        />
                      )}
                    </Field>
                    <button
                      type="button"
                      disabled={busy === role || !draft.candidateKey || !draft.reason.trim()}
                      onClick={() => void applyOverride(role)}
                    >
                      {busy === role ? 'Applying…' : 'Apply audited override'}
                    </button>
                  </div>
                </details>
              ) : null}
            </article>
          );
        })}
      </div>
    </Section>
  );
}

function candidatesFor(
  data: StoredRoleRecommendationView,
  role: RecommendedRoleView,
): RoleRecommendationCandidateView[] {
  return data.recommendation.candidates.filter((candidate) => candidate.role === role);
}

function candidateKey(candidate: RoleRecommendationCandidateView): string {
  return `${candidate.providerId}/${candidate.modelId}`;
}

function percent(value: number | undefined): string {
  return value === undefined ? 'Unknown' : `${Math.round(value * 100)}%`;
}

function confidenceTone(value: number | undefined): 'ok' | 'warn' | 'muted' {
  if (value === undefined) return 'muted';
  return value >= 0.75 ? 'ok' : value >= 0.5 ? 'warn' : 'muted';
}
