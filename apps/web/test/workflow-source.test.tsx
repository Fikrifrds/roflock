import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowSource } from '../src/components/WorkflowSource.js';

/**
 * Studio must show the workflow that actually runs.
 *
 * Both the source and the diagram come from the daemon, so this view cannot
 * drift from the file on disk or from what `roflock render` draws. When there is
 * nothing to show it says so rather than drawing something plausible.
 */

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const RESPONSE = {
  graphVersionId: 'bug_fix@3',
  source: 'workflow bug_fix {\n  version "3.0.0"\n}\n',
  semanticHash: 'sha256:abcdef0123456789abcdef',
  svg: '<svg role="img" aria-label="Workflow bug_fix"><text>writer</text></svg>',
  layout: {
    nodes: [{ id: 'writer' }, { id: 'test' }, { id: 'accept' }],
    edges: [{ kind: 'failure' }],
    loops: [{ nodeIds: ['writer', 'test'], maxAttempts: 4 }],
  },
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(RESPONSE), { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the workflow view', () => {
  it('shows the graph identity and what governs it', async () => {
    wrap(<WorkflowSource taskId="task_1" />);

    expect(await screen.findByText('bug_fix@3')).toBeInTheDocument();
    // The loop budget is the most load-bearing number in a repair loop, so it is
    // shown rather than left for the reader to find in the source.
    expect(screen.getByText(/repair loop of 2 bounded at 4/)).toBeInTheDocument();
    expect(screen.getByText(/3 nodes/)).toBeInTheDocument();
  });

  it('draws the diagram the daemon rendered', async () => {
    wrap(<WorkflowSource taskId="task_1" />);

    // Rendered by graph-ui server-side, so Studio and `roflock render` cannot
    // disagree about what the workflow does.
    const diagram = await screen.findByLabelText('Workflow diagram');
    expect(diagram.querySelector('svg')).not.toBeNull();
  });

  it('shows the source as it is on disk', async () => {
    wrap(<WorkflowSource taskId="task_1" />);

    expect(await screen.findByText(/workflow bug_fix/)).toBeInTheDocument();
  });

  it('says there is nothing to show for a hard-coded template', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'no compiled workflow' }), { status: 409 }),
      ),
    );
    wrap(<WorkflowSource taskId="task_1" />);

    // Drawing something plausible for a graph we cannot lay out would be worse
    // than admitting the gap.
    expect(await screen.findByText(/no source to show/)).toBeInTheDocument();
  });

  it('omits the source block when the daemon has none', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ ...RESPONSE, source: null }), { status: 200 }),
      ),
    );
    wrap(<WorkflowSource taskId="task_1" />);

    await screen.findByText('bug_fix@3');
    expect(screen.queryByText('Source')).not.toBeInTheDocument();
  });
});
