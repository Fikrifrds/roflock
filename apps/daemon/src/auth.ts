import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

export interface Session {
  token: string;
  csrf: string;
}

export function createSession(): Session {
  return { token: randomBytes(32).toString('base64url'), csrf: randomBytes(24).toString('base64url') };
}

export function sessionHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export function authenticate(request: FastifyRequest, session: Session): boolean {
  const queryToken =
    typeof request.query === 'object' &&
    request.query &&
    'token' in request.query &&
    typeof (request.query as { token?: unknown }).token === 'string'
      ? (request.query as { token: string }).token
      : undefined;
  return (
    request.headers['x-roleflock-token'] === session.token ||
    request.cookies.roleflock_token === session.token ||
    queryToken === session.token
  );
}
