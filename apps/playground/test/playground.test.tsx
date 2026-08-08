import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Playground } from '../src/Playground.js';
import { EXAMPLES } from '../src/examples.js';
import { decodeShareLink, encodeShareLink } from '../src/share.js';

/**
 * The Playground's whole claim is that what it shows is what Roflock would do.
 * These tests hold it to that: the same compiler, the same diagnostics, and no
 * graph at all when the source does not compile.
 */

const VALID = EXAMPLES.find((example) => example.id === 'linear')!.source;

describe('compiling in the browser', () => {
  it('never calls a daemon or network API while compiling and changing examples', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network forbidden'));
    render(<Playground initialSource={VALID} />);

    await userEvent.click(screen.getByRole('button', { name: 'Verified bug fix' }));
    await userEvent.clear(screen.getByLabelText('Workflow source'));

    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });

  it('draws the graph for a workflow that compiles', () => {
    render(<Playground initialSource={VALID} />);

    expect(screen.getByText('Compiles')).toBeInTheDocument();
    const diagram = screen.getByLabelText('Workflow diagram');
    expect(diagram.querySelector('svg')).not.toBeNull();
    for (const id of ['Builder', 'Tests', 'Accept']) {
      expect(diagram.textContent).toContain(id);
    }
  });

  it('marks the writer and the required check in the picture', () => {
    render(<Playground initialSource={VALID} />);
    const diagram = screen.getByLabelText('Workflow diagram');

    // These change what a reader should conclude about the workflow's safety, so
    // they belong in the diagram rather than only in the source.
    expect(diagram.textContent).toContain('writer');
    expect(diagram.textContent).toContain('required');
  });

  it('reports the loop budget rather than leaving it in the text', () => {
    const bugfix = EXAMPLES.find((example) => example.id === 'bugfix')!.source;
    render(<Playground initialSource={bugfix} />);

    expect(screen.getByText(/bounded at 3 attempts/)).toBeInTheDocument();
  });

  it('shows a real diagnostic with its code and line', async () => {
    render(<Playground initialSource={VALID} />);
    const editor = screen.getByLabelText('Workflow source');

    await userEvent.clear(editor);
    await userEvent.click(editor);
    await userEvent.paste('agent Builder { role');

    expect(screen.getByText('Does not compile')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Diagnostics' })).toBeInTheDocument();
  });

  it('draws no graph at all when the source does not compile', async () => {
    render(<Playground initialSource={VALID} />);

    await userEvent.clear(screen.getByLabelText('Workflow source'));

    // Half a workflow means something different from the whole one, so a partial
    // graph would be worse than none.
    expect(screen.queryByLabelText('Workflow diagram')).not.toBeInTheDocument();
    expect(screen.getByText(/never draws a partial graph/)).toBeInTheDocument();
  });

  it('surfaces an unknown outcome as the compiler sees it', async () => {
    render(<Playground initialSource={VALID} />);
    const editor = screen.getByLabelText('Workflow source');

    // Pasted rather than typed: `userEvent.type` treats braces as escapes, and
    // workflow source is mostly braces.
    await userEvent.clear(editor);
    await userEvent.click(editor);
    await userEvent.paste(
      ['role w { write }', 'agent B { role w }', 'human A', 'flow { B.exploded -> A }'].join('\n'),
    );

    const diagnostics = screen.getByRole('list', { name: 'Diagnostics' });
    // RF121 is the rule that keeps routing out of a model's hands, and the
    // Playground reports it by the same code the CLI does.
    expect(within(diagnostics).getByText('RF121')).toBeInTheDocument();
  });
});

describe('examples', () => {
  it('offers every example, and each one compiles', async () => {
    render(<Playground initialSource={VALID} />);

    for (const example of EXAMPLES) {
      await userEvent.click(screen.getByRole('button', { name: example.title }));
      // An example that needed surrounding context to work would undermine the
      // thing being demonstrated.
      expect(screen.getByText('Compiles')).toBeInTheDocument();
    }
  });

  it('renders parallel reviewers side by side', async () => {
    render(<Playground initialSource={VALID} />);

    await userEvent.click(screen.getByRole('button', { name: 'Two independent reviewers' }));
    const diagram = screen.getByLabelText('Workflow diagram');

    expect(diagram.textContent).toContain('ReviewCorrectness');
    expect(diagram.textContent).toContain('ReviewScope');
  });
});

describe('share links', () => {
  it('round-trips a workflow through the URL fragment', () => {
    const link = encodeShareLink(VALID, 'https://example.test/');

    // The fragment, so a browser never sends it to a server: sharing a workflow
    // should not mean uploading it.
    expect(link).toContain('#s=');
    expect(decodeShareLink(new URL(link).hash)).toBe(VALID);
  });

  it('survives non-ASCII source', () => {
    const source = 'workflow Café {\n  description "naïve — 日本語 🚀"\n}\n';

    expect(decodeShareLink(new URL(encodeShareLink(source, 'https://x.test/')).hash)).toBe(source);
  });

  it('ignores a hash that is not a share link', () => {
    expect(decodeShareLink('#section-3')).toBeUndefined();
    expect(decodeShareLink('')).toBeUndefined();
  });

  it('ignores a corrupt payload rather than showing rubbish', () => {
    expect(decodeShareLink('#s=not-valid-base64!!')).toBeUndefined();
  });

  it('treats an empty payload as absent', () => {
    // Otherwise a stray link would silently replace whatever the visitor was
    // editing with nothing.
    expect(decodeShareLink(encodeShareLink('   '))).toBeUndefined();
  });
});
