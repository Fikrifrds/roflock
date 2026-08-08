import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FastifyRequest } from 'fastify';
import { readEnv } from '@roleflock/contracts';

export interface Session {
  token: string;
  csrf: string;
}

export function createSession(): Session {
  return {
    token: randomBytes(32).toString('base64url'),
    csrf: randomBytes(24).toString('base64url'),
  };
}

export function sessionHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function sessionFilePath(dataDir: string): string {
  return join(dataDir, 'session.json');
}

/**
 * Persist the session where only this OS user can read it.
 *
 * Loopback is shared by every account on the host, so the token — not the bind
 * address — is what stops another local user from driving the daemon. The file
 * mode is the delivery channel for that token; `writeFileSync`'s `mode` is
 * ignored when the file already exists, hence the explicit `chmodSync`.
 */
export function writeSessionFile(dataDir: string, session: Session): string {
  const file = sessionFilePath(dataDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify({ ...session, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 },
  );
  chmodSync(file, 0o600);
  return file;
}

export function readSessionFile(dataDir: string): Session | undefined {
  try {
    const parsed = JSON.parse(readFileSync(sessionFilePath(dataDir), 'utf8')) as Partial<Session>;
    if (
      typeof parsed.token === 'string' &&
      parsed.token.length >= 32 &&
      typeof parsed.csrf === 'string' &&
      parsed.csrf.length >= 16
    ) {
      return { token: parsed.token, csrf: parsed.csrf };
    }
  } catch {
    // No readable session file yet; the caller mints a fresh one.
  }
  return undefined;
}

/**
 * Reuse the stored session so the launch URL stays stable across restarts.
 * Set `ROFLOCK_ROTATE_TOKEN=1` to invalidate the old token.
 */
export function loadOrCreateSession(dataDir: string): Session {
  if (readEnv('ROTATE_TOKEN') !== '1') {
    const stored = readSessionFile(dataDir);
    if (stored) return stored;
  }
  const session = createSession();
  writeSessionFile(dataDir, session);
  return session;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function safeEqual(candidate: string | undefined, expected: string): boolean {
  if (typeof candidate !== 'string') return false;
  const left = Buffer.from(candidate, 'utf8');
  const right = Buffer.from(expected, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname);
  } catch {
    return false;
  }
}

/**
 * The token is accepted from a header or the httpOnly cookie only. It is never
 * read from the query string: URLs land in proxy and access logs, and the SSE
 * stream used to carry it there.
 */
export function authenticate(request: FastifyRequest, session: Session): boolean {
  return (
    safeEqual(headerValue(request.headers['x-roleflock-token']), session.token) ||
    safeEqual(request.cookies?.roleflock_token, session.token)
  );
}

export function hasValidCsrf(request: FastifyRequest, session: Session): boolean {
  return safeEqual(headerValue(request.headers['x-roleflock-csrf']), session.csrf);
}

export function launchUrl(host: string, port: number, session: Session): string {
  const hostname = host === '::1' || host === '0.0.0.0' ? '127.0.0.1' : host;
  return `http://${hostname}:${port}/?rft=${encodeURIComponent(session.token)}`;
}
