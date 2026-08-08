import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StopTruthfulness } from '../src/components/StopTruthfulness.js';

/**
 * A stop button must not promise more than the driver can deliver.
 *
 * Every shipped driver spawns a local CLI, so `interrupt` returns
 * `stopped: false` — the local process dies and the provider request carries on.
 * The interface is the last place that fact can be lost, and losing it there
 * costs a human real money while they believe they have stopped spending.
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('what stop promises', () => {
  it('warns that remote work may continue and may still be billed', async () => {
    respond({ capability: 'local-process', confirmable: false });

    wrap(<StopTruthfulness taskId="task_1" />);

    const note = await screen.findByRole('note');
    expect(note.textContent).toContain('may continue');
    // The cost is named. "May continue" alone reads as a technical nicety.
    expect(note.textContent).toContain('billed');
    expect(fetch).toHaveBeenCalledWith('/api/tasks/task_1/cancellation', expect.anything());
  });

  it('says nothing when a stop can actually be confirmed', async () => {
    respond({ capability: 'remote-confirmed', confirmable: true });

    wrap(<StopTruthfulness taskId="task_1" />);

    // A caveat attached to a guarantee that does hold is noise, and noise is how
    // a warning stops being read on the run where it is true.
    await waitFor(() => expect(screen.queryByRole('note')).toBeNull());
  });

  it('stays silent rather than guessing before the answer arrives', () => {
    respond({ capability: 'local-process', confirmable: false });

    wrap(<StopTruthfulness taskId="task_1" />);

    expect(screen.queryByRole('note')).toBeNull();
  });

  it('does not pretend a local process was stopped when no harness turn is active', async () => {
    respond({ capability: 'none', confirmable: false, activeTurns: 0 });

    wrap(<StopTruthfulness taskId="task_1" />);

    expect((await screen.findByRole('note')).textContent).toContain(
      'No interruptible harness turn is active',
    );
  });
});
