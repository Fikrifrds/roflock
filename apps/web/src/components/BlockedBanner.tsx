import { Link } from 'react-router-dom';
import type { BlockedRun } from '../types.js';

const ROLE_LABELS: Record<string, string> = {
  planner: 'planner',
  writer: 'executor',
  reviewer: 'reviewer',
  verifier: 'verifier',
};

const REASON_LABELS: Record<string, string> = {
  quota_exhausted: 'out of quota',
  unknown_model: 'model not available on this account',
  unauthenticated: 'not signed in',
};

function relativeUntil(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60_000));
  if (minutes < 1) return 'any moment';
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

/**
 * Shown when a run stopped because every provider configured for a role
 * refused.
 *
 * This is not a defect in the work, so it does not read like one: the finished
 * steps are still good, and the operator needs one thing — point the role at a
 * model that will answer. It says exactly what refused and why, because a
 * developer who can see the provider's own message can act on it.
 */
export function BlockedBanner({
  blocked,
  onRetry,
  retrying,
}: {
  blocked: BlockedRun;
  onRetry: () => void;
  retrying: boolean;
}) {
  const role = ROLE_LABELS[blocked.role] ?? blocked.role;

  return (
    <article className="pending-banner" role="region" aria-label="No provider available">
      <p className="eyebrow">STOPPED — NEEDS A DIFFERENT MODEL</p>
      <h3>Nothing configured for the {role} would answer</h3>
      <p className="hint">
        The steps that already finished are kept. Change the model for this role, then start
        again — the run picks up where it stopped rather than repeating paid work.
      </p>

      <ul className="doc-list">
        {blocked.refusals.map((refusal) => (
          <li key={`${refusal.providerId}-${refusal.modelId}`}>
            <div>
              <b>
                {refusal.providerDisplayName} · {refusal.modelDisplayName}
              </b>
              <small>
                {REASON_LABELS[refusal.reason] ?? refusal.reason.replaceAll('_', ' ')}
                {refusal.until ? ` · retried in ${relativeUntil(refusal.until)}` : ''}
              </small>
              {/* The provider's own words. A developer can usually act on these
                  directly, and paraphrasing them would lose that. */}
              {refusal.detail ? <small className="provider-detail">{refusal.detail}</small> : null}
            </div>
          </li>
        ))}
      </ul>

      <div className="actions">
        <Link className="buttonish" to="/roles">
          Change the {role} model
        </Link>
        <button type="button" className="quiet" disabled={retrying} onClick={onRetry}>
          {retrying ? 'Resuming…' : 'Resume the run'}
        </button>
      </div>
    </article>
  );
}
