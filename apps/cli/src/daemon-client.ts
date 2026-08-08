import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

interface Session {
  token: string;
  csrf: string;
}

export interface DaemonClientOptions {
  baseUrl?: string;
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
  home?: string;
  fetch?: typeof fetch;
}

export class DaemonApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export function resolveCliDataDir(
  options: Pick<DaemonClientOptions, 'dataDir' | 'env' | 'home'> = {},
) {
  const env = options.env ?? process.env;
  const explicit = options.dataDir ?? env.ROFLOCK_DATA_DIR ?? env.ROLEFLOCK_DATA_DIR;
  if (explicit) return explicit;
  const home = options.home ?? homedir();
  const current = join(home, '.roflock');
  if (existsSync(current)) return current;
  const legacy = join(home, '.roleflock');
  return existsSync(legacy) ? legacy : current;
}

function readSession(dataDir: string): Session {
  let parsed: Partial<Session>;
  try {
    parsed = JSON.parse(readFileSync(join(dataDir, 'session.json'), 'utf8')) as Partial<Session>;
  } catch {
    throw new DaemonApiError(
      `No local daemon session found in ${dataDir}. Start Roflock, then retry.`,
      0,
    );
  }
  if (typeof parsed.token !== 'string' || typeof parsed.csrf !== 'string') {
    throw new DaemonApiError(`Invalid daemon session file in ${dataDir}`, 0);
  }
  return { token: parsed.token, csrf: parsed.csrf };
}

export class DaemonClient {
  private readonly baseUrl: string;
  private readonly dataDir: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: DaemonClientOptions = {}) {
    const env = options.env ?? process.env;
    const port = env.ROFLOCK_PORT ?? env.ROLEFLOCK_PORT ?? '4178';
    this.baseUrl = (
      options.baseUrl ??
      env.ROFLOCK_DAEMON_URL ??
      `http://127.0.0.1:${port}`
    ).replace(/\/$/, '');
    this.dataDir = resolveCliDataDir(options);
    this.fetchImpl = options.fetch ?? fetch;
  }

  async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const session = readSession(this.dataDir);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'x-roleflock-token': session.token,
          ...(method === 'POST' ? { 'x-roleflock-csrf': session.csrf } : {}),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw new DaemonApiError(
        `Cannot connect to the local Roflock daemon at ${this.baseUrl}: ${error instanceof Error ? error.message : 'connection failed'}`,
        0,
      );
    }
    const text = await response.text();
    const payload = text ? safeJson(text) : undefined;
    if (!response.ok) {
      const message =
        payload && typeof payload === 'object' && 'error' in payload
          ? String((payload as { error: unknown }).error)
          : `Daemon request failed with HTTP ${response.status}`;
      throw new DaemonApiError(message, response.status, payload);
    }
    return payload as T;
  }
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
