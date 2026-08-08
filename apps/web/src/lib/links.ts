/**
 * Browser-only destinations shared by the shell and dashboard.
 *
 * The Playground is intentionally a separate static app: it compiles source in
 * the browser and never receives the daemon session or local repository access.
 */
export interface PlaygroundEnvironment {
  DEV?: boolean;
  VITE_PLAYGROUND_URL?: string;
}

/**
 * Resolve the browser-safe Playground origin.
 *
 * Production deliberately has no same-origin fallback. Serving the Playground
 * below the daemon origin would give its JavaScript access to the local session
 * storage and API, contradicting the Playground's no-credentials boundary.
 */
export function resolvePlaygroundUrl(env: PlaygroundEnvironment): string | undefined {
  const configured = env.VITE_PLAYGROUND_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (env.DEV && (url.protocol === 'https:' || url.protocol === 'http:')) {
        return url.toString();
      }
      // A production shortcut is a public-site boundary, not a way to point
      // browser code back at loopback. HTTPS also prevents source/share links
      // being modified in transit before they reach the browser compiler.
      if (url.protocol === 'https:' && !isLoopbackHost(url.hostname)) return url.toString();
    } catch {
      // Invalid configuration fails closed: the UI hides the shortcut instead
      // of sending an operator to a broken or unsafe destination.
    }
  }

  return env.DEV ? 'http://127.0.0.1:5174/' : undefined;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return normalized === 'localhost' || normalized === '::1' || normalized.startsWith('127.');
}

const viteEnv = (
  import.meta as ImportMeta & {
    env?: PlaygroundEnvironment;
  }
).env;

export const PLAYGROUND_URL = resolvePlaygroundUrl(viteEnv ?? {});
