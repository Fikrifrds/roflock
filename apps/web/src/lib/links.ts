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
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.toString();
    } catch {
      // Invalid configuration fails closed: the UI hides the shortcut instead
      // of sending an operator to a broken or unsafe destination.
    }
  }

  return env.DEV ? 'http://127.0.0.1:5174/' : undefined;
}

const viteEnv = (
  import.meta as ImportMeta & {
    env?: PlaygroundEnvironment;
  }
).env;

export const PLAYGROUND_URL = resolvePlaygroundUrl(viteEnv ?? {});
