import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { UnauthorizedError } from '../lib/api.js';
import { api, queryClient } from '../lib/client.js';

type Connection = 'connecting' | 'live' | 'unauthorized' | 'error';

const CONNECTION_LABELS: Record<Connection, string> = {
  connecting: 'Connecting…',
  live: 'Connected',
  unauthorized: 'Not authorised',
  error: 'Daemon unreachable',
};

/**
 * The daemon hands the browser its session token exactly once, through the URL
 * it prints at startup. Without that token there is nothing the UI can do, so
 * this replaces the page rather than rendering a half-broken shell.
 */
function Unauthorized() {
  return (
    <main>
      <section className="hero">
        <p>SESSION REQUIRED</p>
        <h1>Open RoleFlock from the daemon&rsquo;s URL.</h1>
        <p className="lede">
          This browser has no RoleFlock session token. The daemon prints a one-time link when it
          starts; open that link and the token is stored for next time.
        </p>
        <pre className="code-block">pnpm url</pre>
        <p className="hint">
          Run that in the project directory to print the link again. The token lives in{' '}
          <code>~/.roleflock/session.json</code> and is readable only by your OS user.
        </p>
      </section>
    </main>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<Connection>('connecting');

  useEffect(() => {
    let closeStream: (() => void) | undefined;
    let cancelled = false;

    void api
      .bootstrap()
      .then(() => {
        if (cancelled) return;
        setConnection('live');
        closeStream = api.stream(() => {
          void queryClient.invalidateQueries();
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setConnection(error instanceof UnauthorizedError ? 'unauthorized' : 'error');
      });

    return () => {
      cancelled = true;
      closeStream?.();
    };
  }, []);

  if (connection === 'unauthorized') return <Unauthorized />;

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header>
        <Link className="wordmark" to="/">
          ROLE<span>FLOCK</span>
        </Link>
        <nav aria-label="Primary">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/projects">Projects</NavLink>
          <NavLink to="/tasks/new">New task</NavLink>
          <NavLink to="/approvals">Approvals</NavLink>
          <NavLink to="/providers">Providers</NavLink>
          <NavLink to="/knowledge" className="nav-secondary">
            Knowledge
          </NavLink>
          <NavLink to="/privacy" className="nav-secondary">
            Privacy
          </NavLink>
        </nav>
        <i
          className={connection === 'live' ? 'live' : connection === 'error' ? 'offline' : ''}
          role="status"
          aria-live="polite"
        >
          {CONNECTION_LABELS[connection]}
        </i>
      </header>
      <main id="main">{children}</main>
    </>
  );
}
