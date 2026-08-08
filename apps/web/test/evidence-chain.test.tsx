import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EvidenceChain } from '../src/components/EvidenceChain.js';

/**
 * The rule under test is the one that makes this view worth having: **a missing
 * link is shown, not omitted.**
 *
 * A panel that rendered only recorded steps would draw a run with no tests as a
 * tidy, complete chain — the reviewer would see three green links and no
 * indication that the fourth question was never asked. That failure mode is
 * invisible by construction, so it is pinned here rather than left to review.
 */

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function respond(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })),
  );
}

const RUNS = [{ id: 'run_1', graphVersionId: 'bug_fix@3', state: 'succeeded' }];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the evidence chain', () => {
  it('shows a link that has nothing behind it', async () => {
    respond({
      taskId: 'task_1',
      runs: RUNS,
      steps: [
        { id: 'change', question: 'What changed?', status: 'recorded', count: 2 },
        { id: 'verify', question: 'Was it verified?', status: 'missing', count: 0 },
      ],
      complete: false,
      gaps: ['verify'],
    });

    wrap(<EvidenceChain taskId="task_1" />);

    // The recorded step is present, which any implementation would manage…
    expect(await screen.findByText('What changed?')).toBeTruthy();
    // …and so is the one nobody answered, which is the part that matters.
    expect(screen.getByText('Was it verified?')).toBeTruthy();
    expect(screen.getByText('nothing recorded')).toBeTruthy();
  });

  it('says an absent record is not evidence that nothing went wrong', async () => {
    respond({
      taskId: 'task_1',
      runs: RUNS,
      steps: [{ id: 'verify', question: 'Was it verified?', status: 'missing', count: 0 }],
      complete: false,
      gaps: ['verify'],
    });

    wrap(<EvidenceChain taskId="task_1" />);

    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('1 link');
    // Stated outright. A reviewer who reads "1 gap" and assumes the gap is
    // cosmetic has drawn exactly the wrong conclusion.
    expect(status.textContent).toContain('not evidence');
  });

  it('does not hedge when every link is backed', async () => {
    respond({
      taskId: 'task_1',
      runs: RUNS,
      steps: [{ id: 'verify', question: 'Was it verified?', status: 'recorded', count: 1 }],
      complete: true,
      gaps: [],
    });

    wrap(<EvidenceChain taskId="task_1" />);

    expect(await screen.findByText(/Every link in the chain is backed/)).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('counts records in the singular when there is one', async () => {
    respond({
      taskId: 'task_1',
      runs: RUNS,
      steps: [{ id: 'verify', question: 'Was it verified?', status: 'recorded', count: 1 }],
      complete: true,
      gaps: [],
    });

    wrap(<EvidenceChain taskId="task_1" />);

    expect(await screen.findByText('1 record')).toBeTruthy();
  });
});

describe('when the chain itself cannot be read', () => {
  it('reports that nothing was checked instead of unmounting the page', async () => {
    // Regression: this panel threw on a payload without `steps` and took the
    // whole Evidence page down with it — the reviewer lost the bundle, the diff
    // and the ledger because the gap reporter could not report a gap.
    respond({ taskId: 'task_1', runs: RUNS });

    wrap(<EvidenceChain taskId="task_1" />);

    const status = await screen.findByRole('status');
    expect(status.textContent).toContain('could not be read');
    // Not silence, and not a clean bill of health.
    expect(status.textContent).toContain('unverified');
  });
});
