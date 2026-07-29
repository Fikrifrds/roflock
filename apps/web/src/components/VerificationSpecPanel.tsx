import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Section, StatusPill } from './primitives.js';
import { api, useData } from '../lib/client.js';
import { ApiError } from '../lib/api.js';
import type { Task } from '../types.js';

type FrozenSpecification = {
  id: string;
  hash: string;
  version: number;
  testMutationPolicy: string;
  checks: Array<{ id: string; description: string; criterionIds: string[]; argv?: string[] }>;
  environment: { credentialProfileId: string; network: string };
};

type SpecificationDraft = {
  verificationCommand: string;
  draft: {
    checks: Array<{ id: string; description: string; criterionIds: string[]; argv: string[] }>;
    testMutationPolicy: string;
    environment: Record<string, unknown>;
    minimumEvidence: unknown[];
  };
};

/**
 * The freeze gate between an approved plan and execution.
 *
 * Until this exists the run has no independent verification to perform, so the
 * panel's job when it is absent is to say exactly that and offer the one action
 * that fixes it — not to sit silent and let the task run unassured by accident.
 */
export function VerificationSpecPanel({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const frozen = useData<{ specification: FrozenSpecification } | null>(
    ['verification-specification', task.id],
    `/api/tasks/${task.id}/verification-specification`,
  );
  const specification = frozen.data?.specification;

  const draft = useData<SpecificationDraft | null>(
    ['verification-specification-draft', task.id],
    `/api/tasks/${task.id}/verification-specification/draft`,
    specification === undefined,
  );

  const freeze = async () => {
    if (!draft.data?.draft) return;
    setBusy(true);
    setError('');
    try {
      await api.request(`/api/tasks/${task.id}/verification-specification`, {
        method: 'POST',
        body: JSON.stringify(draft.data.draft),
      });
      await queryClient.invalidateQueries({ queryKey: ['verification-specification', task.id] });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to freeze verification');
    } finally {
      setBusy(false);
    }
  };

  if (specification) {
    return (
      <Section
        title="Verification specification"
        description="Frozen before execution starts. The executor cannot weaken or remove a required check."
        className="verification-spec-panel"
        actions={
          <div className="contract-status-row">
            <StatusPill tone="ok">frozen</StatusPill>
            <span>v{specification.version}</span>
          </div>
        }
      >
        <div className="verification-subject">
          <span>
            Spec <code title={specification.hash}>{specification.hash.slice(0, 12)}</code>
          </span>
          <span>mutation policy: {specification.testMutationPolicy}</span>
          <span>network: {specification.environment.network}</span>
          <span>credentials: {specification.environment.credentialProfileId}</span>
        </div>
        <ul className="verification-check-list">
          {specification.checks.map((check) => (
            <li key={check.id}>
              <strong>{check.id}</strong>
              <span>{check.description}</span>
              {check.argv ? <code>{check.argv.join(' ')}</code> : null}
              <small>criteria: {check.criterionIds.join(', ')}</small>
            </li>
          ))}
        </ul>
      </Section>
    );
  }

  const unavailable = draft.error instanceof ApiError ? (draft.error.code ?? '') : '';
  return (
    <Section
      title="Verification specification"
      description="The frozen checks an independent runner will execute against the result commit."
    >
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {draft.data?.draft ? (
        <>
          <p className="hint">
            No specification is frozen yet, so this task will run without independent verification
            and cannot produce a Change Passport. Freezing binds these checks to the approved plan
            before the executor starts.
          </p>
          <div className="verification-subject">
            <span>
              command <code>{draft.data.verificationCommand}</code>
            </span>
            <span>{draft.data.draft.checks.length} check(s)</span>
            <span>mutation policy: {draft.data.draft.testMutationPolicy}</span>
          </div>
          <ul className="verification-check-list">
            {draft.data.draft.checks.map((check) => (
              <li key={check.id}>
                <strong>{check.id}</strong>
                <span>{check.description}</span>
                <small>criteria: {check.criterionIds.join(', ')}</small>
              </li>
            ))}
          </ul>
          <div className="actions">
            <button type="button" disabled={busy} onClick={() => void freeze()}>
              {busy ? 'Freezing…' : 'Freeze verification'}
            </button>
          </div>
        </>
      ) : (
        <p className="hint">
          {/* The reason is the actionable part, so it is shown rather than a generic empty state. */}
          {unavailable === 'APPROVED_PLAN_REQUIRED'
            ? 'Approve an Execution Plan first — the specification is frozen against its exact hash.'
            : unavailable === 'AUTHORISED_CONTRACT_REQUIRED'
              ? 'Authorise the Change Contract first — verification checks map to its acceptance criteria.'
              : unavailable === 'VERIFICATION_COMMAND_REQUIRED'
                ? 'This repository has no verification command. Set one on the task so there is real evidence to produce.'
                : 'A verification specification cannot be drafted for this task yet.'}
        </p>
      )}
    </Section>
  );
}
