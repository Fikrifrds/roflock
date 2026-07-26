import { existsSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import cookie from '@fastify/cookie';
import fastify, { type FastifyInstance } from 'fastify';
import statik from '@fastify/static';
import { openMigratedDatabase, ProcessHandleRepository } from '@roleflock/database';
import { OUTCOME_UNKNOWN, reconcileProcess } from '@roleflock/run-control';
import { authenticate, createSession, isLocalOrigin, type Session } from './auth.js';
import { registerApi } from './routes/api.js';
import { EventBus } from './services/event-bus.js';
import { Orchestrator } from './services/orchestrator.js';

export interface ServerOptions { dataDir?: string; host?: string; port?: number; session?: Session; }
export async function createServer(options: ServerOptions = {}): Promise<{ app: FastifyInstance; session: Session; host: string; port: number }> {
  const dataDir = options.dataDir ?? process.env.ROLEFLOCK_DATA_DIR ?? join(homedir(), '.roleflock'); mkdirSync(dataDir, { recursive: true });
  const session = options.session ?? createSession(); const app = fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  await app.register(cookie);
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/api/health' || request.url === '/api/runtime/info' || !request.url.startsWith('/api/')) return;
    if (!authenticate(request, session)) return reply.code(401).send({ error: 'Missing or invalid RoleFlock session token' });
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      if (!isLocalOrigin(request.headers.origin)) return reply.code(403).send({ error: 'Non-local origin rejected' });
      if (request.headers['x-roleflock-csrf'] !== session.csrf) return reply.code(403).send({ error: 'Invalid CSRF token' });
    }
  });
  const db = openMigratedDatabase(join(dataDir, 'roleflock.db'));
  reconcileOrphanedProcesses(db);
  const bus = new EventBus();
  const orchestrator = new Orchestrator(db, bus, join(dataDir, 'worktrees'));
  registerApi(app, db, session, bus, orchestrator);
  const webDist = join(process.cwd(), 'apps', 'web', 'dist');
  if (existsSync(webDist)) await app.register(statik, { root: webDist, wildcard: false });
  app.addHook('onClose', async () => db.close());
  return { app, session, host: options.host ?? '127.0.0.1', port: options.port ?? 4178 };
}

function reconcileOrphanedProcesses(db: ReturnType<typeof openMigratedDatabase>): void {
  const handles = new ProcessHandleRepository(db);
  for (const handle of handles.listRunning()) {
    let running = false;
    try { process.kill(handle.pid, 0); running = true; } catch { running = false; }
    const outcome = reconcileProcess(running);
    handles.setStatus(handle.id, 'unknown', new Date().toISOString());
    if (handle.invocationId) db.prepare('UPDATE invocations SET status = ?, outcome = ?, completed_at = ? WHERE id = ?').run('unknown', outcome ?? OUTCOME_UNKNOWN, new Date().toISOString(), handle.invocationId);
  }
}
