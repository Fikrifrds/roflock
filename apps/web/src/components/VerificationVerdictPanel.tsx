import { Section, StatusPill } from './primitives.js';
import { useData } from '../lib/client.js';
import type { Task, VerificationResultResponse } from '../types.js';

export function VerificationVerdictPanel({ task }: { task: Task }) {
  const query = useData<VerificationResultResponse | null>(
    ['verification-result', task.id],
    `/api/tasks/${task.id}/verification-result`,
  );
  const result = query.data;
  if (!result) {
    return (
      <Section
        title="Independent verification"
        description="Criterion-level assurance from a clean runner, separate from executor claims."
      >
        <p className="hint">
          No independent verification decision exists for this result commit. Executor output and
          self-reported tests do not count as acceptance evidence.
        </p>
      </Section>
    );
  }

  const { decision, attestations } = result;
  return (
    <Section
      title="Independent verification"
      description="Every acceptance criterion is evaluated against attestations bound to the same immutable subject."
      className="verification-verdict-panel"
      actions={
        <StatusPill tone={tone(decision.overallOutcome)}>
          {decision.overallOutcome.replaceAll('_', ' ')}
        </StatusPill>
      }
    >
      <div className="verification-subject">
        <span>
          Result{' '}
          <code title={decision.subject.resultCommit}>{short(decision.subject.resultCommit)}</code>
        </span>
        <span>
          Decision <code title={decision.hash}>{short(decision.hash)}</code>
        </span>
        <span>{attestations.length} clean-runner attestation(s)</span>
      </div>

      {decision.ignoredExecutorClaimIds.length > 0 ? (
        <p className="verification-disclosure">
          {decision.ignoredExecutorClaimIds.length} executor PASS claim(s) disclosed but excluded
          from acceptance evidence.
        </p>
      ) : null}

      <div className="criterion-verdict-list">
        {decision.verdicts.map((verdict) => (
          <article className="criterion-verdict" key={verdict.criterionId}>
            <div>
              <strong>{verdict.criterionId}</strong>
              <StatusPill tone={tone(verdict.outcome)}>
                {verdict.outcome.replaceAll('_', ' ')}
              </StatusPill>
            </div>
            <p>{verdict.explanation}</p>
            <span className="hint">
              {verdict.evidenceRefs.length} evidence · {verdict.findingIds.length} finding
            </span>
          </article>
        ))}
      </div>

      {decision.findings.length > 0 ? (
        <div>
          <h3>Planner-routed findings</h3>
          <ul className="verification-finding-list">
            {decision.findings.map((finding) => (
              <li key={finding.id}>
                <strong>{finding.type.replaceAll('_', ' ')}</strong>
                <span>{finding.summary}</span>
                <small>route: {finding.routedTo}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}

function tone(outcome: string): 'ok' | 'danger' | 'warn' | 'muted' {
  if (outcome === 'pass') return 'ok';
  if (outcome === 'fail') return 'danger';
  if (outcome === 'insufficient_evidence') return 'warn';
  return 'muted';
}

function short(hash: string): string {
  return hash.slice(0, 12);
}
