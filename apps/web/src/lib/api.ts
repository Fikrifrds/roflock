export type ApiClient = ReturnType<typeof createApi>;
export type RuntimeInfo = {
  csrf: string;
  host: string;
  port: number;
  version: string;
  forcedProvider: string | null;
};

export class UnauthorizedError extends Error {
  constructor() {
    super('This browser has no RoleFlock session token.');
    this.name = 'UnauthorizedError';
  }
}

/** A failed daemon response, carrying the API's own reason code when it sent one. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const TOKEN_KEY = 'roleflock-token';
const CSRF_KEY = 'roleflock-csrf';
const TOKEN_PARAM = 'rft';

/**
 * The daemon prints a launch URL carrying the session token. Consume it once,
 * persist it, and scrub it from the address bar so it does not linger in
 * history, bookmarks, or a screen share.
 */
function consumeTokenFromUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const token = hash.get(TOKEN_PARAM) ?? url.searchParams.get(TOKEN_PARAM);
  if (!token) return undefined;

  url.searchParams.delete(TOKEN_PARAM);
  hash.delete(TOKEN_PARAM);
  url.hash = hash.toString() ? `#${hash.toString()}` : '';
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  return token;
}

export type StreamStatus = 'live' | 'reconnecting' | 'closed';

export function createApi() {
  let token = consumeTokenFromUrl() ?? localStorage.getItem(TOKEN_KEY) ?? '';
  let csrf = localStorage.getItem(CSRF_KEY) ?? '';
  if (token) localStorage.setItem(TOKEN_KEY, token);

  /**
   * Exchanges the token for the CSRF value and the httpOnly cookie the event
   * stream rides on. The daemon never returns the token itself, so a caller
   * without one cannot bootstrap its way in.
   */
  async function bootstrap() {
    const response = await fetch('/api/runtime/info', {
      headers: token ? { 'x-roleflock-token': token } : {},
    });
    if (response.status === 401 || response.status === 403) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(CSRF_KEY);
      token = '';
      csrf = '';
      throw new UnauthorizedError();
    }
    if (!response.ok) throw new Error(`Daemon returned ${response.status}`);
    const info = (await response.json()) as RuntimeInfo;
    csrf = info.csrf;
    localStorage.setItem(CSRF_KEY, csrf);
    return info;
  }

  async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
    const method = init.method ?? 'GET';
    const headers: Record<string, string> = {
      'x-roleflock-token': token,
      ...(method !== 'GET' && method !== 'HEAD'
        ? { 'content-type': 'application/json', 'x-roleflock-csrf': csrf }
        : {}),
      ...(init.headers as Record<string, string> | undefined),
    };
    const response = await fetch(path, {
      ...init,
      headers,
      body: init.body ?? (method !== 'GET' && method !== 'HEAD' ? '{}' : undefined),
    });

    // A stale CSRF value survives a token rotation; one re-bootstrap fixes it.
    // A missing token cannot be recovered here, so bootstrap throws instead.
    if ((response.status === 401 || response.status === 403) && !retried) {
      await bootstrap();
      return request<T>(path, init, true);
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };
      // The machine-readable code rides along so callers can branch on the
      // reason instead of string-matching the human sentence, which changes.
      throw new ApiError(body.error ?? response.statusText, response.status, body.code);
    }
    return response.json() as Promise<T>;
  }

  return {
    bootstrap,
    request,
    hasToken: () => Boolean(token),
    // The stream authenticates with the httpOnly cookie set by bootstrap(); the
    // token is deliberately not passed as a query parameter.
    /**
     * `onStatus` reports whether the stream is actually carrying events.
     *
     * Without it the shell said "live" from the moment bootstrap succeeded and
     * never revised it, so a dropped connection looked exactly like a quiet
     * one. That is the worst way for this to fail: the screen keeps showing the
     * last state it saw, and a stalled run reads as a running one.
     */
    stream: (onEvent: () => void, onStatus?: (status: StreamStatus) => void) => {
      const source = new EventSource('/api/events/stream', { withCredentials: true });
      source.onmessage = onEvent;
      source.addEventListener('task.updated', onEvent);
      source.addEventListener('execution.updated', onEvent);
      source.addEventListener('approval.requested', onEvent);
      source.addEventListener('task.failed', onEvent);
      source.onopen = () => {
        // Fired on every successful (re)connect, so recovery is reported too —
        // a banner that appears on failure and never clears is its own lie.
        onStatus?.('live');
        // Anything that changed while disconnected was missed entirely; EventSource
        // replays nothing. Refetching on reconnect is what makes the view true again.
        onEvent();
      };
      source.onerror = () => {
        // CLOSED is terminal: EventSource retries a transient drop by itself but
        // gives up here, so this is the state a human must be told about rather
        // than left waiting through.
        onStatus?.(source.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting');
      };
      return () => source.close();
    },
  };
}
