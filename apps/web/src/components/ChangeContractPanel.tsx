import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Field } from './Field.js';
import { Select } from './Select.js';
import { Section, StatusPill } from './primitives.js';
import { api, useData } from '../lib/client.js';
import type {
  ChangeContract,
  ChangeContractResponse,
  ChangeContractVersionsResponse,
  ContractQuestion,
  Task,
} from '../types.js';

const VERIFICATION_OPTIONS = [
  { value: 'automated_test', label: 'Automated test', description: 'A repeatable test command.' },
  { value: 'static_analysis', label: 'Static analysis', description: 'Lint or type analysis.' },
  { value: 'build', label: 'Build', description: 'A clean production build.' },
  {
    value: 'security_scan',
    label: 'Security scan',
    description: 'A deterministic security check.',
  },
  {
    value: 'performance_measurement',
    label: 'Performance',
    description: 'A measured threshold or comparison.',
  },
  { value: 'visual_review', label: 'Visual review', description: 'Screenshot-based review.' },
  { value: 'manual_review', label: 'Manual review', description: 'A named human review.' },
  {
    value: 'external_observation',
    label: 'External observation',
    description: 'Evidence from another trusted system.',
  },
];

type CriterionDraft = {
  id: string;
  statement: string;
  verificationType: string;
  evidenceIds: string[];
};

type ContractDraft = {
  objective: string;
  criteria: CriterionDraft[];
  prohibited: string;
  outOfScope: string;
  risk: string;
  questions: ContractQuestion[];
};

export function ChangeContractPanel({ task }: { task: Task }) {
  const queryClient = useQueryClient();
  const contractQuery = useData<ChangeContractResponse>(
    ['change-contract', task.id],
    `/api/tasks/${task.id}/change-contract`,
  );
  const response =
    contractQuery.data?.aggregate !== undefined && contractQuery.data.contract !== undefined
      ? contractQuery.data
      : undefined;
  const contract = response?.contract;
  const revision = response?.aggregate.revision;
  const { data: history } = useData<ChangeContractVersionsResponse>(
    ['change-contract-versions', contract?.id ?? 'none'],
    `/api/change-contracts/${contract?.id ?? 'none'}/versions`,
    Boolean(contract),
  );
  const [draft, setDraft] = useState<ContractDraft>(() => emptyDraft(task));
  const [loadedHash, setLoadedHash] = useState('');
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [revisionReason, setRevisionReason] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (contract !== undefined && contract.hash !== loadedHash) {
      setDraft(draftFromContract(contract));
      setLoadedHash(contract.hash);
      setQuestionAnswers({});
    }
  }, [contract, loadedHash]);

  const editable =
    contract === undefined ||
    contract.status === 'draft' ||
    contract.status === 'needs_clarification';
  const blockingOpen = contract?.unresolvedQuestions.some(
    (question) => question.blocking && question.status === 'open',
  );
  const criterionIds = useMemo(
    () => new Set(draft.criteria.map((criterion) => criterion.id)),
    [draft.criteria],
  );

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['change-contract', task.id] });
    if (contract !== undefined) {
      await queryClient.invalidateQueries({
        queryKey: ['change-contract-versions', contract.id],
      });
    }
  };

  const perform = async (label: string, operation: () => Promise<unknown>) => {
    setError('');
    setBusy(label);
    try {
      await operation();
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Change Contract action failed');
      await refresh();
    } finally {
      setBusy('');
    }
  };

  const save = () =>
    perform(contract === undefined ? 'create' : 'save', async () => {
      const body = await contractBody(task, draft, contract);
      if (contract === undefined) {
        return api.request(`/api/tasks/${task.id}/change-contract`, {
          method: 'POST',
          headers: mutationHeaders(),
          body: JSON.stringify(body),
        });
      }
      return api.request(`/api/change-contracts/${contract.id}/draft`, {
        method: 'PATCH',
        headers: mutationHeaders(revision),
        body: JSON.stringify(body),
      });
    });

  const requestAuthorisation = () => {
    if (contract === undefined || revision === undefined) return;
    return perform('request', () =>
      api.request(`/api/change-contracts/${contract.id}/authorisation-request`, {
        method: 'POST',
        headers: mutationHeaders(revision),
      }),
    );
  };

  const authorise = () => {
    if (contract === undefined || revision === undefined) return;
    return perform('authorise', () =>
      api.request(`/api/change-contracts/${contract.id}/authorise`, {
        method: 'POST',
        headers: mutationHeaders(revision),
      }),
    );
  };

  const createRevision = () => {
    if (contract === undefined || revision === undefined || !revisionReason.trim()) return;
    return perform('revise', () =>
      api.request(`/api/change-contracts/${contract.id}/revisions`, {
        method: 'POST',
        headers: mutationHeaders(revision),
        body: JSON.stringify({
          ...semanticContractBody(contract),
          changeReason: revisionReason.trim(),
        }),
      }),
    );
  };

  const resolveQuestion = (question: ContractQuestion) => {
    const resolution = questionAnswers[question.id]?.trim();
    if (!resolution) return;
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((candidate) =>
        candidate.id === question.id
          ? {
              ...candidate,
              status: 'resolved',
              resolution,
              resolvedBy: 'local-user',
              resolvedAt: new Date().toISOString(),
            }
          : candidate,
      ),
    }));
  };

  if (contractQuery.isLoading) {
    return (
      <Section title="Change contract" description="Checking the task's authority boundary…">
        <p className="hint">Loading contract…</p>
      </Section>
    );
  }

  return (
    <Section
      title="Change contract"
      description="Authoritative outcome, acceptance, exclusions, and evidence. Agents may propose this contract; only you can authorise it."
      className="contract-panel"
      actions={
        contract ? (
          <div className="contract-status-row">
            <StatusPill tone={statusTone(contract.status)}>
              {contract.status.replaceAll('_', ' ')}
            </StatusPill>
            <span>
              v{contract.version} · revision {revision}
            </span>
          </div>
        ) : undefined
      }
    >
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      {editable ? (
        <div className="contract-editor">
          <Field
            label="Objective"
            htmlFor="contract-objective"
            hint="Describe the outcome. Keep implementation choices out unless they are authoritative."
          >
            <textarea
              id="contract-objective"
              value={draft.objective}
              onChange={(event) =>
                setDraft((current) => ({ ...current, objective: event.target.value }))
              }
              rows={3}
            />
          </Field>

          <fieldset className="contract-fieldset">
            <legend>Acceptance criteria</legend>
            <p className="hint">Every criterion must name how RoleFlock will verify it.</p>
            <div className="contract-list">
              {draft.criteria.map((criterion, index) => (
                <article className="criterion-card" key={criterion.id}>
                  <div className="criterion-heading">
                    <strong>{criterion.id}</strong>
                    {draft.criteria.length > 1 ? (
                      <button
                        type="button"
                        className="quiet compact-button"
                        aria-label={`Remove ${criterion.id}`}
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            criteria: current.criteria.filter(
                              (candidate) => candidate.id !== criterion.id,
                            ),
                          }))
                        }
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                  <Field label="Criterion" htmlFor={`criterion-${criterion.id}`}>
                    <textarea
                      id={`criterion-${criterion.id}`}
                      className="compact"
                      value={criterion.statement}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          criteria: current.criteria.map((candidate) =>
                            candidate.id === criterion.id
                              ? { ...candidate, statement: event.target.value }
                              : candidate,
                          ),
                        }))
                      }
                    />
                  </Field>
                  <Field label="Verification" htmlFor={`verification-${criterion.id}`}>
                    <Select
                      id={`verification-${criterion.id}`}
                      value={criterion.verificationType}
                      options={VERIFICATION_OPTIONS}
                      onChange={(value) =>
                        setDraft((current) => ({
                          ...current,
                          criteria: current.criteria.map((candidate) =>
                            candidate.id === criterion.id
                              ? { ...candidate, verificationType: value }
                              : candidate,
                          ),
                        }))
                      }
                    />
                  </Field>
                </article>
              ))}
            </div>
            <button
              type="button"
              className="quiet"
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  criteria: [...current.criteria, nextCriterion(criterionIds)],
                }))
              }
            >
              Add criterion
            </button>
          </fieldset>

          <div className="contract-grid">
            <Field
              label="Prohibited outcomes"
              htmlFor="contract-prohibited"
              hint="One forbidden outcome per line."
              optional
            >
              <textarea
                id="contract-prohibited"
                className="compact"
                value={draft.prohibited}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, prohibited: event.target.value }))
                }
              />
            </Field>
            <Field
              label="Out of scope"
              htmlFor="contract-out-of-scope"
              hint="One explicit exclusion per line."
              optional
            >
              <textarea
                id="contract-out-of-scope"
                className="compact"
                value={draft.outOfScope}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, outOfScope: event.target.value }))
                }
              />
            </Field>
          </div>

          {draft.questions.length > 0 ? (
            <div className="contract-questions" aria-label="Contract clarification questions">
              <h3>Clarifications</h3>
              {draft.questions.map((question) => (
                <article key={question.id} className="contract-question">
                  <div>
                    <strong>{question.question}</strong>
                    <span>
                      {question.blocking ? 'Blocking' : 'Non-blocking'} · {question.status}
                    </span>
                  </div>
                  {question.status === 'open' ? (
                    <>
                      <input
                        aria-label={`Answer ${question.id}`}
                        value={questionAnswers[question.id] ?? ''}
                        onChange={(event) =>
                          setQuestionAnswers((answers) => ({
                            ...answers,
                            [question.id]: event.target.value,
                          }))
                        }
                        placeholder="Authoritative answer"
                      />
                      <button
                        type="button"
                        className="quiet"
                        disabled={!questionAnswers[question.id]?.trim()}
                        onClick={() => resolveQuestion(question)}
                      >
                        Mark resolved
                      </button>
                    </>
                  ) : (
                    <p>{question.resolution}</p>
                  )}
                </article>
              ))}
            </div>
          ) : null}

          <div className="actions">
            <button
              type="button"
              disabled={
                !draft.objective.trim() ||
                draft.criteria.some((criterion) => !criterion.statement.trim()) ||
                Boolean(busy)
              }
              onClick={() => void save()}
            >
              {busy === 'create'
                ? 'Creating…'
                : busy === 'save'
                  ? 'Saving…'
                  : contract
                    ? 'Save contract'
                    : 'Create change contract'}
            </button>
            {contract ? (
              <button
                type="button"
                className="quiet"
                disabled={Boolean(busy)}
                onClick={() => void requestAuthorisation()}
              >
                {busy === 'request' ? 'Submitting…' : 'Submit for authorisation'}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <ContractReview contract={contract} />
      )}

      {contract?.status === 'awaiting_authorisation' ? (
        <article className="contract-authority-callout" aria-label="Contract authorisation">
          <div>
            <p className="eyebrow">Your authority required</p>
            <h3>Authorise this exact contract</h3>
            <p>
              This seals hash <code>{shortHash(contract.hash)}</code>. Agents cannot change it; any
              feedback that changes intent creates a new version.
            </p>
            {blockingOpen ? (
              <p className="error">Resolve every blocking clarification before authorising.</p>
            ) : null}
          </div>
          <button
            type="button"
            disabled={Boolean(blockingOpen || busy)}
            onClick={() => void authorise()}
          >
            {busy === 'authorise' ? 'Authorising…' : 'Authorise contract'}
          </button>
        </article>
      ) : null}

      {contract?.status === 'authorised' ? (
        <div className="contract-revision">
          <Field
            label="Need to change intent?"
            htmlFor="contract-revision-reason"
            hint="A revision preserves this authorised version and returns control to planning."
          >
            <input
              id="contract-revision-reason"
              value={revisionReason}
              onChange={(event) => setRevisionReason(event.target.value)}
              placeholder="Reason for a new contract version"
            />
          </Field>
          <button
            type="button"
            className="quiet"
            disabled={!revisionReason.trim() || Boolean(busy)}
            onClick={() => void createRevision()}
          >
            {busy === 'revise' ? 'Creating revision…' : 'Create revision'}
          </button>
        </div>
      ) : null}

      {history && history.versions.length > 0 ? (
        <details className="contract-history">
          <summary>Version history ({history.versions.length})</summary>
          <ol>
            {[...history.versions].reverse().map((version) => (
              <li key={version.versionId}>
                <span>v{version.contract.version}</span>
                <strong>{version.contract.status.replaceAll('_', ' ')}</strong>
                <code>{shortHash(version.contract.hash)}</code>
                {version.contract.changeReason ? (
                  <small>{version.contract.changeReason}</small>
                ) : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </Section>
  );
}

function ContractReview({ contract }: { contract: ChangeContract }) {
  return (
    <div className="contract-review">
      <article>
        <span>Objective</span>
        <p>{contract.objective}</p>
      </article>
      <article>
        <span>Acceptance criteria</span>
        <ol>
          {contract.acceptanceCriteria.map((criterion) => (
            <li key={criterion.id}>
              <strong>{criterion.id}</strong>
              <p>{criterion.statement}</p>
              <small>{criterion.verificationType.replaceAll('_', ' ')}</small>
            </li>
          ))}
        </ol>
      </article>
      {contract.prohibitedOutcomes.length > 0 ? (
        <article>
          <span>Prohibited outcomes</span>
          <ul>
            {contract.prohibitedOutcomes.map((outcome) => (
              <li key={outcome.id}>{outcome.statement}</li>
            ))}
          </ul>
        </article>
      ) : null}
      {contract.outOfScope.length > 0 ? (
        <article>
          <span>Out of scope</span>
          <ul>
            {contract.outOfScope.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      ) : null}
      <div className="contract-seal">
        <span>Semantic hash</span>
        <code title={contract.hash}>{contract.hash}</code>
        {contract.authorisedBy ? (
          <small>
            Authorised by {contract.authorisedBy} ·{' '}
            {new Date(contract.authorisedAt ?? '').toLocaleString()}
          </small>
        ) : null}
      </div>
    </div>
  );
}

function emptyDraft(task: Task): ContractDraft {
  return {
    objective: task.brief,
    criteria: [
      {
        id: 'AC-1',
        statement: task.expectedBehaviour ?? '',
        verificationType: 'automated_test',
        evidenceIds: ['E-1'],
      },
    ],
    prohibited: '',
    outOfScope: '',
    risk: task.risk,
    questions: [],
  };
}

function draftFromContract(contract: ChangeContract): ContractDraft {
  return {
    objective: contract.objective,
    criteria: contract.acceptanceCriteria.map((criterion, index) => ({
      id: criterion.id,
      statement: criterion.statement,
      verificationType: criterion.verificationType,
      evidenceIds:
        criterion.requiredEvidenceIds.length > 0
          ? criterion.requiredEvidenceIds
          : [`E-${index + 1}`],
    })),
    prohibited: contract.prohibitedOutcomes.map((outcome) => outcome.statement).join('\n'),
    outOfScope: contract.outOfScope.join('\n'),
    risk: contract.risk,
    questions: contract.unresolvedQuestions,
  };
}

async function contractBody(task: Task, draft: ContractDraft, current?: ChangeContract) {
  const criteria = draft.criteria.map((criterion) => ({
    id: criterion.id,
    statement: criterion.statement.trim(),
    verificationType: criterion.verificationType,
    requiredEvidenceIds: criterion.evidenceIds,
  }));
  return {
    objective: draft.objective.trim(),
    acceptanceCriteria: criteria,
    prohibitedOutcomes: lines(draft.prohibited).map((statement, index) => ({
      id: current?.prohibitedOutcomes[index]?.id ?? `PO-${index + 1}`,
      statement,
      severity: current?.prohibitedOutcomes[index]?.severity ?? task.risk,
    })),
    outOfScope: lines(draft.outOfScope),
    risk: draft.risk,
    requiredEvidence: uniqueEvidence(criteria).map(({ evidenceId, criterion }) => {
      const existing = current?.requiredEvidence.find(
        (requirement) => requirement.id === evidenceId,
      );
      return (
        existing ?? {
          id: evidenceId,
          type: evidenceType(criterion.verificationType),
          description: `Evidence for ${criterion.id}: ${criterion.statement}`,
          mandatory: true,
        }
      );
    }),
    authoritySources: current?.authoritySources ?? [
      {
        id: 'SRC-1',
        kind: 'user_input',
        locator: `task://${task.id}/brief`,
        digest: await sha256(task.brief),
        title: 'Original task brief',
      },
    ],
    unresolvedQuestions: draft.questions,
  };
}

function semanticContractBody(contract: ChangeContract) {
  return {
    objective: contract.objective,
    acceptanceCriteria: contract.acceptanceCriteria,
    prohibitedOutcomes: contract.prohibitedOutcomes,
    outOfScope: contract.outOfScope,
    risk: contract.risk,
    requiredEvidence: contract.requiredEvidence,
    authoritySources: contract.authoritySources,
    unresolvedQuestions: contract.unresolvedQuestions,
  };
}

function evidenceType(verificationType: string): string {
  const types: Record<string, string> = {
    automated_test: 'test_result',
    static_analysis: 'static_analysis_result',
    build: 'build_result',
    security_scan: 'security_scan_result',
    performance_measurement: 'performance_result',
    visual_review: 'visual_artifact',
    manual_review: 'manual_attestation',
    external_observation: 'external_attestation',
  };
  return types[verificationType] ?? 'manual_attestation';
}

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function nextCriterion(existing: Set<string>): CriterionDraft {
  let number = existing.size + 1;
  while (existing.has(`AC-${number}`)) number += 1;
  return {
    id: `AC-${number}`,
    statement: '',
    verificationType: 'automated_test',
    evidenceIds: [`E-${number}`],
  };
}

function uniqueEvidence(
  criteria: Array<{
    id: string;
    statement: string;
    verificationType: string;
    requiredEvidenceIds: string[];
  }>,
): Array<{ evidenceId: string; criterion: (typeof criteria)[number] }> {
  const seen = new Set<string>();
  const result: Array<{ evidenceId: string; criterion: (typeof criteria)[number] }> = [];
  for (const criterion of criteria) {
    for (const evidenceId of criterion.requiredEvidenceIds) {
      if (!seen.has(evidenceId)) {
        seen.add(evidenceId);
        result.push({ evidenceId, criterion });
      }
    }
  }
  return result;
}

function mutationHeaders(revision?: number): Record<string, string> {
  return {
    'idempotency-key': commandId(),
    'x-roleflock-actor-id': 'local-user',
    ...(revision === undefined ? {} : { 'if-match': `"${revision}"` }),
  };
}

function commandId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `ui-${Date.now()}-${Math.random()}`;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

function statusTone(status: ChangeContract['status']): 'ok' | 'warn' | 'info' | 'muted' {
  if (status === 'authorised') return 'ok';
  if (status === 'awaiting_authorisation' || status === 'needs_clarification') return 'warn';
  if (status === 'draft') return 'info';
  return 'muted';
}
