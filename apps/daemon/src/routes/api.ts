import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Task } from '@roleflock/contracts';
import { ConfirmationRepository, EvidenceRepository, ProjectRepository, TaskRepository, UsageRepository, type SqliteDb } from '@roleflock/database';
import { registerRepository } from '@roleflock/repository-runtime';
import type { Session } from '../auth.js';
import { EventBus } from '../services/event-bus.js';
import { Orchestrator } from '../services/orchestrator.js';

export function registerApi(app: FastifyInstance, db: SqliteDb, session: Session, bus: EventBus, orchestrator: Orchestrator): void {
  const projects = new ProjectRepository(db), tasks = new TaskRepository(db), approvals = new ConfirmationRepository(db), evidence = new EvidenceRepository(db), usage = new UsageRepository(db);
  app.get('/api/health', async () => ({
    ok: true,
    status: 'ok',
    product: 'RoleFlock',
    version: '0.1.0',
    host: '127.0.0.1',
    port: 4178,
    service: 'roleflock-daemon',
  }));
  app.get('/api/runtime/info', async (_request, reply) => { reply.setCookie('roleflock_token', session.token, { httpOnly: true, sameSite: 'strict', path: '/' }); return { host: '127.0.0.1', port: 4178, token: session.token, csrf: session.csrf, provider: 'fake' }; });
  app.get('/api/events/stream', async (request, reply) => {
    reply.hijack(); reply.raw.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    const unsubscribe = bus.subscribe((event) => reply.raw.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
    request.raw.on('close', unsubscribe);
  });
  app.post('/api/projects', async (request, reply) => {
    const body = request.body as { path?: string; name?: string; baseBranch?: string }; if (!body.path) return reply.code(400).send({ error: 'path is required' });
    const repository = await registerRepository(body.path); const time = now();
    const project = { id: randomUUID(), workspaceId: 'local', name: body.name ?? repository.root.split('/').pop() ?? 'Repository', repositoryPath: body.path, resolvedPath: repository.root, baseBranch: body.baseBranch ?? 'HEAD', status: 'active', createdAt: time, updatedAt: time };
    projects.create(project); bus.publish('project.created', project); return reply.code(201).send(project);
  });
  app.get('/api/projects', async () => projects.list());
  app.post('/api/projects/:id/validate', async (request, reply) => { const project = projects.get((request.params as { id: string }).id); if (!project) return reply.code(404).send({ error: 'Project not found' }); const repository = await registerRepository(project.resolvedPath); return { valid: true, root: repository.root }; });
  app.post('/api/tasks', async (request, reply) => {
    const body = request.body as Partial<Task>; if (!body.projectId || !body.title || !body.brief) return reply.code(400).send({ error: 'projectId, title, and brief are required' });
    const task: Task = { id: randomUUID(), projectId: body.projectId, type: body.type ?? 'bug_fix', title: body.title, brief: body.brief, risk: body.risk ?? 'medium', state: 'ready', workflowGraphVersionId: 'bug-fix-v1', budgetPolicyId: 'local-default', expectedBehaviour: body.expectedBehaviour, actualBehaviour: body.actualBehaviour, maxAttempts: body.maxAttempts ?? 3, maxActualCostUsd: body.maxActualCostUsd, createdAt: now(), updatedAt: now() };
    tasks.upsert(task); bus.publish('task.created', task); return reply.code(201).send(task);
  });
  app.get('/api/tasks', async (request) => tasks.list((request.query as { projectId?: string }).projectId));
  app.get('/api/tasks/:id', async (request, reply) => { const task = tasks.get((request.params as { id: string }).id); return task ?? reply.code(404).send({ error: 'Task not found' }); });
  app.post('/api/tasks/:id/start', async (request, reply) => { const task = tasks.get((request.params as { id: string }).id); if (!task) return reply.code(404).send({ error: 'Task not found' }); const project = projects.get(task.projectId); if (!project) return reply.code(400).send({ error: 'Task project missing' }); orchestrator.start(task, project.resolvedPath, project.baseBranch); return reply.code(202).send({ accepted: true }); });
  for (const action of ['pause', 'resume', 'cancel'] as const) app.post(`/api/tasks/:id/${action}`, async (request) => { orchestrator.control((request.params as { id: string }).id, action); return { accepted: true }; });
  for (const action of ['accept', 'reject'] as const) {
    app.post(`/api/tasks/:id/${action}`, async (request, reply) => {
      const task = tasks.get((request.params as { id: string }).id);
      if (!task) return reply.code(404).send({ error: 'Task not found' });
      orchestrator.resolveAcceptance(task.id, action === 'accept' ? 'accepted' : 'rejected');
      return { accepted: true };
    });
  }
  app.get('/api/tasks/:id/active-execution', async (request) => {
    const taskId = (request.params as { id: string }).id;
    const row = db
      .prepare(
        `SELECT projection_json FROM active_executions WHERE task_id = ? ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(taskId) as { projection_json?: string } | undefined;
    if (!row?.projection_json) return null;
    return JSON.parse(row.projection_json);
  });
  app.get('/api/runs/:id', async (request) => db.prepare('SELECT * FROM graph_runs WHERE id = ?').get((request.params as { id: string }).id) ?? null);
  app.get('/api/runs/:id/events', async (request) => db.prepare('SELECT * FROM events WHERE aggregate_id = ? ORDER BY sequence').all((request.params as { id: string }).id));
  app.get('/api/runs/:id/active-execution', async (request) => db.prepare('SELECT projection_json FROM active_executions WHERE graph_run_id = ? ORDER BY updated_at DESC LIMIT 1').get((request.params as { id: string }).id) ?? null);
  for (const action of ['stop', 'force-terminate', 'retry'] as const) app.post(`/api/nodes/:id/${action}`, async (request) => { const row = db.prepare('SELECT task_id FROM active_executions WHERE node_run_id = ?').get((request.params as { id: string }).id) as { task_id?: string } | undefined; if (row?.task_id) orchestrator.control(row.task_id, action); return { accepted: true }; });
  app.get('/api/approvals', async () => approvals.listPending());
  for (const decision of ['approve', 'reject'] as const) {
    app.post(`/api/approvals/:id/${decision}`, async (request) => {
      const id = (request.params as { id: string }).id;
      orchestrator.resolveConfirmation(id, decision === 'approve' ? 'approved' : 'rejected');
      return { accepted: true };
    });
  }
  app.post('/api/approval-groups/:id/approve-all-once', async () => ({ accepted: true }));
  app.post('/api/approval-grants', async () => ({ id: randomUUID(), accepted: true }));
  app.post('/api/approval-grants/:id/revoke', async () => ({ accepted: true }));
  app.get('/api/providers', async () => [{ id: 'fake', displayName: 'Phase 0 Fake Provider', status: 'ready', capabilities: { streaming: true, tools: true, writes: false, headless: true } }]);
  app.post('/api/providers', async () => ({ id: randomUUID(), accepted: true }));
  app.post('/api/providers/:id/health-check', async () => ({ healthy: true }));
  app.get('/api/providers/:id/capabilities', async () => ({ streaming: true, tools: true, writes: false, headless: true }));
  app.get('/api/providers/:id/models', async () => [{ id: 'phase0-fake', displayName: 'Phase 0 Fake' }]);
  app.get('/api/evidence/tasks/:taskId', async (request) => evidence.getBundle((request.params as { taskId: string }).taskId));
  app.get('/api/usage/tasks/:taskId', async (request) => ({ entries: usage.listByTask((request.params as { taskId: string }).taskId), summary: usage.summarize((request.params as { taskId: string }).taskId) }));
}
const now = () => new Date().toISOString();
