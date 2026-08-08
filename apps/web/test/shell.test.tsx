import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Shell } from '../src/components/Shell.js';
import { renderApp, stubApi } from './render.js';

describe('Shell', () => {
  it('shows the launch-URL instructions when the browser has no token', async () => {
    localStorage.clear();
    stubApi({ '/api/runtime/info': { error: 'unauthorised' } });
    // stubApi always answers 200; force the unauthorised path explicitly.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 401 })),
    );

    renderApp(
      <Shell>
        <p>protected</p>
      </Shell>,
    );

    expect(await screen.findByText(/Open Roflock from the daemon/i)).toBeInTheDocument();
    expect(screen.getByText('roflock studio')).toBeInTheDocument();
    expect(screen.queryByText('protected')).not.toBeInTheDocument();
  });

  it('renders navigation and reports the live connection once bootstrapped', async () => {
    localStorage.setItem('roleflock-token', 'tok');
    stubApi({ '/api/runtime/info': { csrf: 'csrf' } });

    renderApp(
      <Shell>
        <p>protected</p>
      </Shell>,
    );

    expect(screen.getByText('protected')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Roflock Playground' })).toHaveAttribute(
      'href',
      expect.stringContaining('5174'),
    );
    expect(screen.getByRole('link', { name: 'Skip to content' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Connected'));
  });

  it('keeps simulation mode visibly distinct from real verification', async () => {
    localStorage.setItem('roleflock-token', 'tok');
    stubApi({
      '/api/runtime/info': {
        csrf: 'csrf',
        host: '127.0.0.1',
        port: 4178,
        version: '0.1.0',
        forcedProvider: 'fake',
      },
    });

    renderApp(
      <Shell>
        <p>simulation content</p>
      </Shell>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /results are not production verification/i,
    );
  });
});
