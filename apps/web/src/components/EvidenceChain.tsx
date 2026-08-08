import { useData } from '../lib/client.js';

/**
 * The evidence chain a reviewer walks, with its gaps named.
 *
 * The rule this view exists to honour: **a missing link is shown, not omitted.**
 * A panel that listed only what exists would show a run with no verification as
 * a run that needed none — precisely the impression evidence is supposed to
 * prevent. Every question appears whether or not it was answered.
 */

interface Step {
  id: string;
  question: string;
  status: 'recorded' | 'missing';
  count: number;
  detail?: string;
}

interface Chain {
  taskId: string;
  runs: Array<{ id: string; graphVersionId: string; state: string }>;
  steps: Step[];
  complete: boolean;
  gaps: string[];
}

export function EvidenceChain({ taskId }: { taskId: string }) {
  const { data, isLoading } = useData<Chain>(
    ['evidence-chain', taskId],
    `/api/evidence/tasks/${taskId}/chain`,
  );

  if (isLoading) return <p>Reading the record…</p>;
  if (!data) return null;

  // A payload without steps means the chain could not be read — an older daemon,
  // a failed query. That is reported, never rendered as an empty chain, because
  // "no steps shown" and "no gaps found" would look identical to a reviewer.
  //
  // Defended rather than assumed for a second reason: this panel sits inside the
  // Evidence page, and an exception here unmounts the whole page. A view whose
  // purpose is to surface missing evidence must not be the thing that hides it.
  if (!Array.isArray(data.steps)) {
    return (
      <section aria-label="Evidence chain">
        <h2>Why you should believe this</h2>
        <p role="status">
          The evidence chain could not be read, so nothing here has been checked. Treat this as
          unverified rather than as verified-and-clean.
        </p>
      </section>
    );
  }

  const gaps = data.gaps ?? [];

  return (
    <section aria-label="Evidence chain">
      <h2>Why you should believe this</h2>
      <p>Assembled from what was recorded while the run happened — never re-derived afterwards.</p>

      <ul aria-label="Chain">
        {data.steps.map((step) => (
          <li key={step.id} data-status={step.status}>
            <strong>{step.status === 'recorded' ? '✓' : '✗'}</strong> {step.question}{' '}
            <span>
              {step.status === 'recorded'
                ? `${step.count} record${step.count === 1 ? '' : 's'}`
                : 'nothing recorded'}
            </span>
            {step.detail ? <div>{step.detail}</div> : null}
          </li>
        ))}
      </ul>

      {data.complete ? (
        <p>Every link in the chain is backed by a record.</p>
      ) : (
        <p role="status">
          {/* Stated, not implied. An absent record is not evidence that nothing
              went wrong — it is evidence that nobody checked. */}
          {gaps.length} link{gaps.length === 1 ? '' : 's'} in this chain have nothing behind them.
          An absent record is not evidence of absence of a problem.
        </p>
      )}
    </section>
  );
}
