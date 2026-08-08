import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { UnauthorizedError, type RuntimeInfo } from '../lib/api.js';
import { api, queryClient } from '../lib/client.js';
import { TaskInbox } from './TaskInbox.js';

type Connection = 'connecting' | 'live' | 'reconnecting' | 'closed' | 'unauthorized' | 'error';

const CONNECTION_LABELS: Record<Connection, string> = {
  connecting: 'Connecting…',
  live: 'Connected',
  // Both of these say the screen is out of date, because that is the thing a
  // human needs to know. "Reconnecting" alone invites waiting; what matters is
  // that what they are reading is no longer current.
  reconnecting: 'Reconnecting — this view may be out of date',
  closed: 'Disconnected — this view is out of date, reload to reconnect',
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
  const [runtime, setRuntime] = useState<RuntimeInfo>();

  useEffect(() => {
    let closeStream: (() => void) | undefined;
    let cancelled = false;

    void api
      .bootstrap()
      .then((info) => {
        if (cancelled) return;
        setRuntime(info);
        setConnection('live');
        closeStream = api.stream(
          () => {
            void queryClient.invalidateQueries();
          },
          (status) => {
            if (!cancelled) setConnection(status);
          },
        );
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
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="activity-rail">
        <Link className="rail-mark" to="/" aria-label="RoleFlock home">
          RF
        </Link>
        <nav aria-label="Primary">
          <NavLink to="/" end aria-label="Task inbox" title="Task inbox">
            <span aria-hidden="true">▤</span>
          </NavLink>
          <NavLink to="/projects" aria-label="Projects" title="Projects">
            <span aria-hidden="true">◇</span>
          </NavLink>
          <NavLink to="/tasks/new" aria-label="New task" title="New task">
            <span aria-hidden="true">＋</span>
          </NavLink>
          <NavLink to="/approvals" aria-label="Approvals" title="Approvals">
            <span aria-hidden="true">✓</span>
          </NavLink>
          <NavLink to="/knowledge" aria-label="Knowledge" title="Knowledge">
            <span aria-hidden="true">◎</span>
          </NavLink>
        </nav>
        <nav className="rail-bottom" aria-label="Configuration">
          <NavLink to="/roles" aria-label="Agent roles" title="Agent roles">
            <span aria-hidden="true">⌘</span>
          </NavLink>
          <NavLink to="/providers" aria-label="Providers" title="Providers">
            <span aria-hidden="true">⌁</span>
          </NavLink>
          <NavLink to="/privacy" aria-label="Settings and privacy" title="Settings and privacy">
            <span aria-hidden="true">⚙</span>
          </NavLink>
        </nav>
      </aside>
      <TaskInbox />
      <div className="workbench">
        <header className="workbench-bar">
          <Link className="wordmark" to="/">
            ROLE<span>FLOCK</span>
          </Link>
          <div className="workbench-principle">
            <span className="principle-dot" />
            Governed agent workspace
          </div>
          <i
            className={
              connection === 'live'
                ? 'live'
                : connection === 'error' || connection === 'closed'
                  ? 'offline'
                  : ''
            }
            role="status"
            aria-live="polite"
          >
            {CONNECTION_LABELS[connection]}
          </i>
        </header>
        {runtime?.forcedProvider === 'fake' ? (
          <aside className="simulation-banner" role="alert">
            <strong>Simulation mode.</strong> Providers, code changes, and tests are scripted;
            results are not production verification.
          </aside>
        ) : null}
        <main id="main" className="app-main">
          {children}
        </main>
      </div>
    </div>
  );
}
