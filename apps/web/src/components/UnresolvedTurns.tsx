import type { GraphRunView } from '../types.js';

/**
 * Turns that were paid for and whose result nobody observed (ADR-010).
 *
 * The runtime already refuses to guess here: re-running might pay twice for one
 * result, skipping might discard work that succeeded, so it halts and leaves the
 * decision to a human. That halt was invisible. The reason travelled to the
 * browser inside the node's `outcome` string and nothing rendered it, so the
 * operator saw a stopped task, no explanation, and no idea a decision was
 * waiting on them — which makes the halt worse than useless, because the run is
 * blocked and nobody knows why.
 */

export function UnresolvedTurns({ run }: { run: GraphRunView | undefined }) {
  const unresolved = (run?.graph?.nodes ?? []).filter((node) => node.unresolvedInvocation);
  if (unresolved.length === 0) return null;

  return (
    <aside role="alert" aria-label="Unresolved billable turns">
      <h2>This run is waiting on you</h2>
      <p>
        {unresolved.length === 1 ? 'A step was' : `${unresolved.length} steps were`} sent to a
        provider and the result was never observed — most often because Roflock stopped while the
        turn was in flight. It may have been billed, and it may have succeeded.
      </p>
      <ul>
        {unresolved.map((node) => (
          <li key={node.id}>
            <strong>{node.id}</strong>
            {node.primaryProviderDisplayName ? ` · ${node.primaryProviderDisplayName}` : null}
            {/* The halt message the runtime recorded, shown verbatim rather than
                paraphrased — it names the provider and the node involved. */}
            {node.outcome ? <p>{node.outcome}</p> : null}
          </li>
        ))}
      </ul>
      <p>
        {/* Both directions are stated because both cost something. An operator
            told only "retry" will double-pay; told only "skip" will silently
            drop completed work. */}
        Check the provider&apos;s own history before continuing: retrying pays for the turn a second
        time, and skipping it discards whatever it produced.
      </p>
    </aside>
  );
}
