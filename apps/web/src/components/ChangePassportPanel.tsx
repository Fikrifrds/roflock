import { Section, StatusPill } from './primitives.js';
import { useData } from '../lib/client.js';
import type { ChangePassportResponse, Task } from '../types.js';

export function ChangePassportPanel({ task }: { task: Task }) {
  const query = useData<ChangePassportResponse | null>(
    ['change-passport', task.id],
    `/api/tasks/${task.id}/change-passport`,
  );
  const response = query.data;
  if (!response) {
    return (
      <Section
        title="Change Passport"
        description="Portable, signed delivery evidence bound to one exact result commit."
      >
        <p className="hint">
          No Change Passport has been issued. A task result is not portable assurance until the
          issuance gates pass and a runner identity signs it.
        </p>
      </Section>
    );
  }

  const packet = response.reviewPacket;
  const verdict = response.revocation ? 'revoked' : packet.verdict;
  return (
    <Section
      title="Change Passport"
      description="Human-readable review packet derived from the signed payload."
      className="passport-panel"
      actions={
        <div className="passport-actions">
          <StatusPill tone={tone(verdict)}>{verdict}</StatusPill>
          <a href={`/api/change-passports/${response.passport.passportId}/export`}>
            Export signed passport
          </a>
        </div>
      }
    >
      <div className={`passport-trust passport-trust-${packet.assurance.issuerTrust}`}>
        <span className="eyebrow">ISSUER TRUST</span>
        <strong>{packet.assurance.issuerTrustLabel}</strong>
        <p>
          {packet.assurance.verification.replaceAll('_', ' ')} ·{' '}
          {packet.assurance.execution.replaceAll('_', ' ')}
        </p>
      </div>

      <div className="passport-subject-grid">
        <div>
          <span className="eyebrow">RESULT COMMIT</span>
          <code title={packet.subject.resultCommit}>{short(packet.subject.resultCommit)}</code>
        </div>
        <div>
          <span className="eyebrow">PAYLOAD DIGEST</span>
          <code title={response.passport.payloadDigest}>
            {short(response.passport.payloadDigest)}
          </code>
        </div>
        <div>
          <span className="eyebrow">EVIDENCE</span>
          <strong>{packet.evidence.availability.replaceAll('_', ' ')}</strong>
        </div>
        <div>
          <span className="eyebrow">APPROVALS</span>
          <strong>{packet.approvals}</strong>
        </div>
      </div>

      {response.revocation ? (
        <div className="passport-revocation" role="alert">
          <strong>Revoked {new Date(response.revocation.revokedAt).toLocaleString()}</strong>
          <span>{response.revocation.reason}</span>
        </div>
      ) : null}

      {packet.caveats.length > 0 ? (
        <ul className="passport-caveats">
          {packet.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      ) : null}

      <div className="passport-criteria">
        <h3>Acceptance criteria</h3>
        {packet.criteria.length === 0 ? (
          <p className="hint">Criterion detail is not included in this review view.</p>
        ) : (
          packet.criteria.map((criterion) => (
            <article key={criterion.criterionId}>
              <div>
                <strong>{criterion.criterionId}</strong>
                <StatusPill tone={tone(criterion.outcome)}>{criterion.outcome}</StatusPill>
              </div>
              <p>{criterion.explanation}</p>
              <small>{criterion.evidenceCount} evidence reference(s)</small>
            </article>
          ))
        )}
      </div>
    </Section>
  );
}

function tone(value: string): 'ok' | 'danger' | 'warn' | 'muted' {
  if (value === 'pass') return 'ok';
  if (value === 'fail' || value === 'revoked') return 'danger';
  if (value === 'conditional' || value === 'insufficient_evidence') return 'warn';
  return 'muted';
}

function short(value: string): string {
  return value.slice(0, 12);
}
