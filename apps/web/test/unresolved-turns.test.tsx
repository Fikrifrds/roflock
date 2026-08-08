import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GraphRunView } from '../src/types.js';
import { UnresolvedTurns } from '../src/components/UnresolvedTurns.js';

/**
 * A run halted under ADR-010 is waiting on a human decision.
 *
 * The runtime refuses to guess whether a paid turn should be repeated, and stops.
 * If the interface does not say so, the halt is worse than not halting: the run
 * is blocked, money may already be spent, and nobody is told a decision is due.
 */

function run(nodes: Array<Record<string, unknown>>): GraphRunView {
  return { graph: { nodes } } as unknown as GraphRunView;
}

describe('unresolved billable turns', () => {
  it('raises an alert naming the step that is waiting', () => {
    render(
      <UnresolvedTurns
        run={run([
          { id: 'implement', unresolvedInvocation: true, outcome: 'outcome is unknown' },
          { id: 'review', unresolvedInvocation: false, outcome: null },
        ])}
      />,
    );

    // `alert`, not a quiet note: the run is stopped until someone acts.
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText('implement')).toBeTruthy();
    expect(screen.queryByText('review')).toBeNull();
  });

  it('states the cost of both choices, not just one', () => {
    render(<UnresolvedTurns run={run([{ id: 'implement', unresolvedInvocation: true }])} />);

    const alert = screen.getByRole('alert');
    // Told only to retry, an operator double-pays; told only to skip, they
    // silently discard completed work. Both have to be on screen.
    expect(alert.textContent).toContain('pays for the turn a second time');
    expect(alert.textContent).toContain('discards whatever it produced');
  });

  it('shows the runtime’s own halt message rather than a paraphrase', () => {
    const message =
      'A previous run already invoked implement against claude-1 and its outcome is unknown.';

    render(
      <UnresolvedTurns
        run={run([{ id: 'implement', unresolvedInvocation: true, outcome: message }])}
      />,
    );

    expect(screen.getByText(message)).toBeTruthy();
  });

  it('stays out of the way when there is nothing unresolved', () => {
    render(<UnresolvedTurns run={run([{ id: 'implement', unresolvedInvocation: false }])} />);

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders nothing before the run has loaded', () => {
    render(<UnresolvedTurns run={undefined} />);

    expect(screen.queryByRole('alert')).toBeNull();
  });
});
