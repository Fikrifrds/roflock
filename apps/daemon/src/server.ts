import { existsSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import cookie from '@fastify/cookie';
import fastify, { type FastifyInstance } from 'fastify';
import statik from '@fastify/static';
import {
  openMigratedDatabase,
  ProcessHandleRepository,
  ProviderConnectionRepository,
} from '@roleflock/database';
import { WriterLease } from '@roleflock/repository-runtime';
import { OUTCOME_UNKNOWN, reconcileProcess } from '@roleflock/run-control';
import {
  authenticate,
  hasValidCsrf,
  isLocalOrigin,
  loadOrCreateSession,
  type Session,
} from './auth.js';
import { registerApi } from './routes/api.js';
import { EventBus } from './services/event-bus.js';
import { Orchestrator } from './services/orchestrator.js';
import { seedPricingDefaults } from './services/pricing.js';
import { ProviderRegistry } from './services/provider-registry.js';
import { DocumentService } from './services/documents.js';
import { LocalSecretStore } from './services/local-secret-store.js';
import { ReviewAppService } from './services/review-app.js';

export interface ServerOptions {
  dataDir?: string;
  host?: string;
  port?: number;
  session?: Session;
}
export interface ServerHandle {
  app: FastifyInstance;
  session: Session;
  host: string;
  port: number;
  dataDir: string;
}

const DEFAULT_PORT = 4178;

export function resolvePort(value = process.env.ROLEFLOCK_PORT): number {
  if (value === undefined || value.trim() === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid ROLEFLOCK_PORT: ${value}. Expected an integer from 1 to 65535.`);
  }
  return port;
}

export async function createServer(options: ServerOptions = {}): Promise<ServerHandle> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? resolvePort();
  const dataDir =
    options.dataDir ?? process.env.ROLEFLOCK_DATA_DIR ?? join(homedir(), '.roleflock');
  mkdirSync(dataDir, { recursive: true });
  const session = options.session ?? loadOrCreateSession(dataDir);
  const app = fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 3 * 1024 * 1024,
  });
  await app.register(cookie);
  app.addHook('onRequest', async (request, reply) => {
    if (!request.url.startsWith('/api/')) return;
    // Liveness only; it carries no session material and no repository data.
    if (request.url === '/api/health') return;
    if (!isLocalOrigin(request.headers.origin)) {
      return reply.code(403).send({ error: 'Non-local origin rejected' });
    }
    if (!authenticate(request, session)) {
      return reply.code(401).send({ error: 'Missing or invalid RoleFlock session token' });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      if (!hasValidCsrf(request, session)) {
        return reply.code(403).send({ error: 'Invalid CSRF token' });
      }
    }
  });
  const db = openMigratedDatabase(join(dataDir, 'roleflock.db'));
  seedPricingDefaults(db);
  reconcileOrphanedProcesses(db);
  reconcileInterruptedGraphRuns(db);
  reconcileWriterLeases(db);
  const bus = new EventBus();
  const providers = new ProviderRegistry();
  const providerConnections = new ProviderConnectionRepository(db);
  const providerSecrets = new LocalSecretStore(dataDir);
  for (const connection of providerConnections.listCustom()) {
    try {
      providers.registerCustom({
        id: connection.id,
        displayName: connection.displayName,
        endpoint: connection.endpoint,
        model: connection.model,
        apiKey: connection.apiKeySecretId
          ? ((await providerSecrets.get(connection.apiKeySecretId)) ?? '')
          : '',
      });
    } catch (error) {
      app.log.warn(
        { err: error, providerId: connection.id },
        'Unable to restore custom provider connection',
      );
    }
  }
  const documents = new DocumentService(db, join(dataDir, 'documents'));
  const reviewApps = new ReviewAppService();
  // Passport signing keys live in their own encrypted store, never beside
  // provider credentials and never in SQLite.
  const signingSecrets = new LocalSecretStore(dataDir, 'runner-signing');
  const orchestrator = new Orchestrator(
    db,
    bus,
    join(dataDir, 'worktrees'),
    providers,
    documents,
    signingSecrets,
  );
  registerApi(
    app,
    db,
    session,
    bus,
    orchestrator,
    providers,
    documents,
    dataDir,
    providerSecrets,
    reviewApps,
    {
      host,
      port,
    },
  );
  const webDist = join(process.cwd(), 'apps', 'web', 'dist');
  if (existsSync(webDist)) {
    await app.register(statik, { root: webDist, wildcard: false });
    // The UI is a single-page app, so every client route has to resolve to its
    // shell. Without this a bookmarked or refreshed task URL returned the API's
    // 404 JSON instead of the page the user was looking at.
    app.setNotFoundHandler((request, reply) => {
      if (request.method !== 'GET' || request.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }
  app.addHook('onClose', async () => {
    await reviewApps.close();
    db.close();
  });
  return { app, session, host, port, dataDir };
}

/**
 * Nothing is executing a graph the moment the process dies, so any run still
 * marked `running` at startup is a leftover. Marking it `interrupted` — rather
 * than `failed` — is what lets the orchestrator resume its completed nodes when
 * the user starts the task again.
 */
function reconcileInterruptedGraphRuns(db: ReturnType<typeof openMigratedDatabase>): void {
  const at = new Date().toISOString();
  db.prepare(
    "UPDATE graph_runs SET state = 'interrupted', completed_at = ? WHERE state = 'running'",
  ).run(at);
  db.prepare(
    "UPDATE node_runs SET state = 'interrupted', completed_at = ? WHERE state = 'running'",
  ).run(at);
  // The process sweep below only closes invocations that still have a live
  // handle, so one whose handle was already retired kept claiming to be running
  // for the life of the database.
  db.prepare(
    "UPDATE invocations SET status = 'interrupted', outcome = COALESCE(outcome, 'interrupted'), completed_at = ? WHERE status = 'running'",
  ).run(at);
}

/**
 * Writer leases represent live process ownership and therefore cannot survive
 * a daemon process boundary. The worktree and task concurrency slot do survive:
 * after restart the task reclaims its durable admission and takes a fresh
 * writer lease when it reaches the executor again.
 */
function reconcileWriterLeases(db: ReturnType<typeof openMigratedDatabase>): void {
  const at = new Date().toISOString();
  const worktrees = db
    .prepare(`SELECT path FROM worktrees WHERE writer_lease_id IS NOT NULL`)
    .all() as Array<{ path: string }>;
  db.prepare(
    `UPDATE runtime_leases SET released_at = ?
     WHERE resource_type = 'writer' AND released_at IS NULL`,
  ).run(at);
  db.prepare(`UPDATE worktrees SET writer_lease_id = NULL WHERE writer_lease_id IS NOT NULL`).run();
  for (const worktree of worktrees) WriterLease.clear(worktree.path);
}

function reconcileOrphanedProcesses(db: ReturnType<typeof openMigratedDatabase>): void {
  const handles = new ProcessHandleRepository(db);
  for (const handle of handles.listRunning()) {
    let running: boolean;
    // Signal 0 probes liveness without delivering anything; ESRCH means gone.
    try {
      process.kill(handle.pid, 0);
      running = true;
    } catch {
      running = false;
    }
    const outcome = reconcileProcess(running);
    handles.setStatus(handle.id, 'unknown', new Date().toISOString());
    if (handle.invocationId)
      db.prepare(
        'UPDATE invocations SET status = ?, outcome = ?, completed_at = ? WHERE id = ?',
      ).run('unknown', outcome ?? OUTCOME_UNKNOWN, new Date().toISOString(), handle.invocationId);
  }
}
