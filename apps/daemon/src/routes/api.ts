import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ActiveExecution, Task } from '@roleflock/contracts';
import {
  AuditRepository,
  ApprovalGrantRepository,
  ConfirmationRepository,
  DisclosureGrantRepository,
  EvidenceRepository,
  LocalKnowledgeRepository,
  PriceCardRepository,
  ProviderConnectionRepository,
  ProjectRepository,
  QuotaSnapshotRepository,
  TaskRepository,
  UsageRepository,
  WorktreeRepository,
  type KnowledgeState,
  type KnowledgeType,
  type RoleCandidateInput,
  type SqliteDb,
} from '@roleflock/database';
import { compileContext, ROLE_CONTRACTS, type RoleId } from '@roleflock/context-compiler';
import { getWorkflowGraph, recommendWorkflow, workflowGraphs } from '@roleflock/graph-core';
import { budgetStatus } from '@roleflock/usage-ledger';
import { EFFORT_LEVELS, isEffort } from '@roleflock/provider-core';
import {
  initializeEmptyRepository,
  registerRepository,
  RepositoryRegistrationError,
} from '@roleflock/repository-runtime';
import type { Session } from '../auth.js';
import { EventBus } from '../services/event-bus.js';
import { chooseDirectory, DirectoryPickerCancelled } from '../services/directory-picker.js';
import {
  backupLocalData,
  buildDiagnosticsExport,
  buildTaskAuditExport,
  buildTaskEvidenceExport,
  deleteLocalData,
} from '../services/export-service.js';
import { getProviderAccount } from '../services/cli-account.js';
import { Orchestrator, resolveTaskGraph } from '../services/orchestrator.js';
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROUTED_ROLES,
  isRoutedRole,
} from '../services/role-defaults.js';
import { customProviderId, ProviderRegistry } from '../services/provider-registry.js';
import { DocumentService, isDocumentAuthority, isDocumentKind } from '../services/documents.js';
import { LocalSecretStore } from '../services/local-secret-store.js';
import { checkForUpdates, getLocalVersion } from '../services/version-check.js';
import { discoverVerificationCommand } from '../services/verification-command.js';
import {
  commitTaskWorkspace,
  inspectTaskFileDiff,
  inspectTaskWorkspace,
  pushTaskWorkspace,
  stageTaskFiles,
  unstageTaskFiles,
} from '../services/task-workspace.js';

export function registerApi(
  app: FastifyInstance,
  db: SqliteDb,
  session: Session,
  bus: EventBus,
  orchestrator: Orchestrator,
  providers: ProviderRegistry,
  documents: DocumentService,
  dataDir: string,
  providerSecrets: LocalSecretStore,
  runtime: { host: string; port: number },
): void {
  const projects = new ProjectRepository(db),
    tasks = new TaskRepository(db),
    approvals = new ConfirmationRepository(db),
    approvalGrants = new ApprovalGrantRepository(db),
    disclosureGrants = new DisclosureGrantRepository(db),
    evidence = new EvidenceRepository(db),
    usage = new UsageRepository(db),
    providerConnections = new ProviderConnectionRepository(db),
    worktrees = new WorktreeRepository(db),
    audit = new AuditRepository(db);
  app.get('/api/health', async () => ({
    ok: true,
    status: 'ok',
    product: 'RoleFlock',
    version: '0.1.0',
    host: runtime.host,
    port: runtime.port,
    service: 'roleflock-daemon',
  }));
  /**
   * Authenticated: the caller already holds the token. This exchanges it for the
   * httpOnly cookie (so EventSource works without putting the token in a URL) and
   * the CSRF value. It must never hand out the token itself.
   */
  app.get('/api/runtime/info', async (_request, reply) => {
    reply.setCookie('roleflock_token', session.token, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
    });
    return {
      host: runtime.host,
      port: runtime.port,
      csrf: session.csrf,
      version: getLocalVersion(),
      forcedProvider: process.env.ROLEFLOCK_FORCE_FAKE === '1' ? 'fake' : null,
    };
  });
  app.get('/api/events/stream', async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    reply.raw.write(
      `event: connected\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`,
    );
    const unsubscribe = bus.subscribe((event) =>
      reply.raw.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`),
    );
    request.raw.on('close', unsubscribe);
  });
  app.post('/api/dialogs/choose-directory', async (_request, reply) => {
    try {
      const path = await chooseDirectory('Select a local Git repository');
      return { path, cancelled: false };
    } catch (error) {
      if (error instanceof DirectoryPickerCancelled) {
        return reply.code(200).send({ path: null, cancelled: true });
      }
      return reply.code(500).send({
        error: error instanceof Error ? error.message : 'Failed to open folder picker',
      });
    }
  });
  app.post('/api/projects', async (request, reply) => {
    const body = request.body as { path?: string; name?: string; baseBranch?: string };
    if (!body.path) return reply.code(400).send({ error: 'path is required' });
    let repository;
    let gitInitialized = false;
    try {
      repository = await registerRepository(body.path);
    } catch (error) {
      if (error instanceof RepositoryRegistrationError && error.code === 'NOT_GIT_REPOSITORY') {
        try {
          repository = await initializeEmptyRepository(body.path);
          gitInitialized = true;
        } catch (initializationError) {
          if (initializationError instanceof RepositoryRegistrationError) {
            const statusCode = initializationError.code === 'PATH_NOT_FOUND' ? 404 : 422;
            return reply
              .code(statusCode)
              .send({ code: initializationError.code, error: initializationError.message });
          }
          throw initializationError;
        }
      } else if (error instanceof RepositoryRegistrationError) {
        const statusCode = error.code === 'PATH_NOT_FOUND' ? 404 : 422;
        return reply.code(statusCode).send({ code: error.code, error: error.message });
      } else {
        throw error;
      }
    }
    const time = now();
    const folderName = repository.root.split('/').filter(Boolean).pop() ?? 'Repository';
    const project = {
      id: randomUUID(),
      workspaceId: 'local',
      name: body.name?.trim() || folderName,
      repositoryPath: body.path,
      resolvedPath: repository.root,
      baseBranch: body.baseBranch ?? 'HEAD',
      status: 'active',
      createdAt: time,
      updatedAt: time,
    };
    projects.create(project);
    bus.publish('project.created', project);
    return reply.code(201).send({ ...project, gitInitialized });
  });
  app.get('/api/projects', async () => projects.list());
  app.patch('/api/projects/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const body = request.body as { name?: string };
    if (!body.name?.trim()) return reply.code(400).send({ error: 'name is required' });
    const existing = projects.get(id);
    if (!existing) return reply.code(404).send({ error: 'Project not found' });
    const updated = projects.updateName(id, body.name, now());
    bus.publish('project.updated', updated);
    return updated;
  });
  app.post('/api/projects/:id/validate', async (request, reply) => {
    const project = projects.get((request.params as { id: string }).id);
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    let repository;
    try {
      repository = await registerRepository(project.resolvedPath);
    } catch (error) {
      if (error instanceof RepositoryRegistrationError) {
        const statusCode = error.code === 'PATH_NOT_FOUND' ? 404 : 422;
        return reply.code(statusCode).send({ code: error.code, error: error.message });
      }
      throw error;
    }
    return { valid: true, root: repository.root };
  });
  app.post('/api/tasks', async (request, reply) => {
    const body = request.body as Partial<Task> & { mode?: string };
    if (!body.projectId || !body.title || !body.brief) {
      return reply.code(400).send({ error: 'projectId, title, and brief are required' });
    }
    const mode =
      body.mode ??
      recommendWorkflow({
        type: (body.type ?? 'bug_fix') as Parameters<typeof recommendWorkflow>[0]['type'],
        risk: body.risk,
      }).mode;
    let workflowGraphVersionId: string;
    try {
      // Pin the task to a versioned graph so its shape cannot change mid-run.
      workflowGraphVersionId = getWorkflowGraph(mode).version;
    } catch {
      return reply.code(400).send({ error: `Unknown workflow mode: ${mode}` });
    }
    const task: Task = {
      id: randomUUID(),
      projectId: body.projectId,
      type: body.type ?? 'bug_fix',
      title: body.title,
      brief: body.brief,
      risk: body.risk ?? 'medium',
      state: 'ready',
      workflowGraphVersionId,
      budgetPolicyId: 'local-default',
      expectedBehaviour: body.expectedBehaviour,
      actualBehaviour: body.actualBehaviour,
      verificationCommand: body.verificationCommand,
      maxAttempts: body.maxAttempts ?? 3,
      maxActualCostUsd: body.maxActualCostUsd,
      createdAt: now(),
      updatedAt: now(),
    };
    tasks.upsert(task);
    bus.publish('task.created', task);
    return reply.code(201).send(task);
  });
  app.get('/api/tasks/:id/verification-suggestion', async (request, reply) => {
    const task = tasks.get((request.params as { id: string }).id);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    const project = projects.get(task.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    return { command: await discoverVerificationCommand(project.resolvedPath) };
  });
  app.patch('/api/tasks/:id/verification-command', async (request, reply) => {
    const command = (request.body as { verificationCommand?: string }).verificationCommand?.trim();
    if (!command) return reply.code(400).send({ error: 'verificationCommand is required' });
    const updated = tasks.updateVerificationCommand(
      (request.params as { id: string }).id,
      command,
      now(),
    );
    if (!updated) return reply.code(404).send({ error: 'Task not found' });
    bus.publish('task.updated', updated);
    return updated;
  });
  /**
   * The role roster: every role, its ordered candidate list, and the model
   * catalogue each provider actually offers. One call so the picker never has
   * to guess what a provider supports.
   */
  app.get('/api/roles', async () => {
    const assignments = orchestrator.router.listAll();
    const cooldowns = orchestrator.router.activeCooldowns();
    const listed = await providers.list();

    const catalogue = await Promise.all(
      listed.map(async (provider) => ({
        providerId: provider.id,
        displayName: provider.displayName,
        status: provider.status,
        models: await providers.models(provider.id).catch(() => []),
      })),
    );

    return {
      roles: ROUTED_ROLES.map((role) => ({
        id: role,
        label: ROLE_LABELS[role],
        description: ROLE_DESCRIPTIONS[role],
        candidates: assignments[role].map((candidate) => ({
          providerId: candidate.providerConnectionId,
          modelId: candidate.modelId,
          effort: candidate.effort,
          enabled: candidate.enabled,
          coolingDownUntil: cooldowns.find(
            (item) =>
              item.providerConnectionId === candidate.providerConnectionId &&
              item.modelId === candidate.modelId,
          )?.until,
        })),
      })),
      providers: catalogue,
      efforts: EFFORT_LEVELS,
      cooldowns,
    };
  });

  app.put('/api/roles/:role', async (request, reply) => {
    const role = (request.params as { role: string }).role;
    if (!isRoutedRole(role)) return reply.code(400).send({ error: `Unknown role: ${role}` });

    const body = request.body as { candidates?: unknown };
    if (!Array.isArray(body.candidates)) {
      return reply.code(400).send({ error: 'candidates must be an array' });
    }

    const candidates: RoleCandidateInput[] = [];
    for (const entry of body.candidates) {
      const item = entry as Record<string, unknown>;
      const providerId = typeof item.providerId === 'string' ? item.providerId.trim() : '';
      const modelId = typeof item.modelId === 'string' ? item.modelId.trim() : '';
      if (!providerId || !modelId) {
        return reply.code(400).send({ error: 'each candidate needs providerId and modelId' });
      }
      if (!providers.has(providerId)) {
        return reply.code(400).send({ error: `Unknown provider: ${providerId}` });
      }
      if (item.effort !== undefined && item.effort !== null && !isEffort(item.effort)) {
        return reply.code(400).send({ error: `effort must be one of ${EFFORT_LEVELS.join(', ')}` });
      }
      candidates.push({
        providerConnectionId: providerId,
        modelId,
        effort: isEffort(item.effort) ? item.effort : undefined,
        enabled: item.enabled !== false,
      });
    }

    // An empty list would leave the role with nothing to route to, and the
    // router would silently drop to the fake provider on the next run.
    if (candidates.length === 0) {
      return reply.code(400).send({ error: 'a role needs at least one candidate' });
    }

    return { role, candidates: orchestrator.router.replaceRole(role, candidates) };
  });

  app.post('/api/roles/:role/reset', async (request, reply) => {
    const role = (request.params as { role: string }).role;
    if (!isRoutedRole(role)) return reply.code(400).send({ error: `Unknown role: ${role}` });
    return { role, candidates: orchestrator.router.resetRole(role) };
  });

  app.post('/api/cooldowns/clear', async (request, reply) => {
    const body = request.body as { providerId?: string; modelId?: string };
    if (!body.providerId || !body.modelId) {
      return reply.code(400).send({ error: 'providerId and modelId are required' });
    }
    orchestrator.router.clearCooldown(body.providerId, body.modelId);
    return { cleared: true, cooldowns: orchestrator.router.activeCooldowns() };
  });

  app.get('/api/workflows', async () =>
    Object.values(workflowGraphs).map((graph) => ({
      id: graph.id,
      version: graph.version,
      label: graph.label,
      description: graph.description,
      roles: graph.nodes.map((node) => node.id),
      maxConcurrency: graph.maxConcurrency,
      maxLoopIterations: graph.maxLoopIterations,
    })),
  );

  /**
   * Read-only run view: the immutable graph the task was pinned to, joined with
   * the recorded state of each node. Purely observational — it schedules nothing.
   */
  app.get('/api/tasks/:id/graph', async (request, reply) => {
    const taskId = (request.params as { id: string }).id;
    const task = tasks.get(taskId);
    if (!task) return reply.code(404).send({ error: 'Task not found' });

    let graph;
    try {
      graph = resolveTaskGraph(task);
    } catch (error) {
      return reply
        .code(409)
        .send({ error: error instanceof Error ? error.message : 'Unknown workflow graph' });
    }

    const run = db
      .prepare('SELECT * FROM graph_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(taskId) as
      | {
          id: string;
          state: string;
          graph_version_id: string;
          blocked_role: string | null;
          blocked_reason: string | null;
          blocked_detail: string | null;
        }
      | undefined;
    const nodeRuns = run
      ? (db
          .prepare(
            'SELECT node_key, state, outcome, started_at, completed_at FROM node_runs WHERE graph_run_id = ? ORDER BY created_at ASC',
          )
          .all(run.id) as Array<{
          node_key: string;
          state: string;
          outcome: string | null;
          started_at: string | null;
          completed_at: string | null;
        }>)
      : [];

    // Latest attempt wins: a node re-entered through a failure edge has several rows.
    const latest = new Map<string, (typeof nodeRuns)[number]>();
    for (const nodeRun of nodeRuns) latest.set(nodeRun.node_key, nodeRun);

    // A run that has stopped for good will never schedule what it never
    // started. Reporting those nodes as `pending` made a failed run look like
    // it was still queueing work. An interrupted run is genuinely resumable, so
    // its untouched nodes stay pending.
    const unreachedState =
      run && (run.state === 'failed' || run.state === 'cancelled') ? 'skipped' : 'pending';

    // Present only when the run stopped because no configured provider would
    // answer. The remedy is the operator's, so the UI needs enough to say what
    // refused and point at where to change it.
    const blocked = run?.blocked_role
      ? {
          role: run.blocked_role,
          reason: run.blocked_reason ?? 'unavailable',
          refusals: ((): unknown[] => {
            try {
              return JSON.parse(run.blocked_detail ?? '[]') as unknown[];
            } catch {
              return [];
            }
          })(),
          resumable: run.state === 'interrupted',
        }
      : null;

    const primaryByRole = new Map<
      string,
      ReturnType<typeof orchestrator.router.listRole>[number] | undefined
    >();
    for (const node of graph.nodes) {
      if (isRoutedRole(node.role)) {
        primaryByRole.set(node.role, orchestrator.router.listRole(node.role)[0]);
      }
    }
    const primaryProviderIds = [
      ...new Set(
        [...primaryByRole.values()]
          .filter((candidate) => Boolean(candidate))
          .map((candidate) => candidate!.providerConnectionId),
      ),
    ];
    const providerCatalogue = await providers.list();
    const modelsByProvider = new Map(
      await Promise.all(
        primaryProviderIds.map(
          async (providerId) =>
            [providerId, await providers.models(providerId).catch(() => [])] as const,
        ),
      ),
    );

    return {
      taskId,
      graphRunId: run?.id ?? null,
      runState: run?.state ?? 'not_started',
      blocked,
      graph: {
        id: graph.id,
        version: graph.version,
        label: graph.label,
        description: graph.description,
        maxConcurrency: graph.maxConcurrency,
        maxLoopIterations: graph.maxLoopIterations,
        edges: graph.edges,
        nodes: graph.nodes.map((node) => {
          const primary = primaryByRole.get(node.role);
          const providerDisplayName = primary
            ? (providerCatalogue.find((provider) => provider.id === primary.providerConnectionId)
                ?.displayName ?? primary.providerConnectionId)
            : null;
          const modelDisplayName = primary
            ? (modelsByProvider
                .get(primary.providerConnectionId)
                ?.find((model) => model.id === primary.modelId)?.displayName ?? primary.modelId)
            : null;
          return {
            id: node.id,
            role: node.role,
            kind: node.kind,
            dependsOn: node.dependsOn,
            required: node.required ?? false,
            writer: node.writer ?? false,
            maxAttempts: node.maxAttempts ?? 1,
            focus: node.focus ?? null,
            primaryProviderId: primary?.providerConnectionId ?? null,
            primaryProviderDisplayName: providerDisplayName,
            primaryModelId: primary?.modelId ?? null,
            primaryModelDisplayName: modelDisplayName,
            state: latest.get(node.id)?.state ?? unreachedState,
            outcome: latest.get(node.id)?.outcome ?? null,
            startedAt: latest.get(node.id)?.started_at ?? null,
            completedAt: latest.get(node.id)?.completed_at ?? null,
            attempts: nodeRuns.filter((entry) => entry.node_key === node.id).length,
          };
        }),
      },
    };
  });
  app.get('/api/workflows/recommend', async (request) => {
    const query = request.query as { type?: string; risk?: string };
    const type = (query.type ?? 'feature') as Parameters<typeof recommendWorkflow>[0]['type'];
    const risk = query.risk as Parameters<typeof recommendWorkflow>[0]['risk'] | undefined;
    const recommendation = recommendWorkflow({ type, risk });
    const graph = getWorkflowGraph(recommendation.mode);
    return {
      ...recommendation,
      version: graph.version,
      label: graph.label,
      description: graph.description,
      roles: graph.nodes.map((node) => node.id),
    };
  });
  app.get('/api/task-intents', async () => [
    { id: 'new_product', label: 'Build a New Product', description: 'Greenfield product work' },
    { id: 'feature', label: 'Add a Feature', description: 'Extend an existing codebase' },
    { id: 'bug_fix', label: 'Fix a Bug', description: 'Verified fix with regression checks' },
    {
      id: 'refactor',
      label: 'Refactor Code',
      description: 'Improve structure without behaviour change',
    },
    {
      id: 'investigation',
      label: 'Investigate an Issue',
      description: 'Diagnose before changing code',
    },
    {
      id: 'review_changes',
      label: 'Review Existing Changes',
      description: 'Inspect a local diff or branch',
    },
    { id: 'documentation', label: 'Documentation', description: 'Docs-only updates' },
    { id: 'security_fix', label: 'Security Fix', description: 'High-assurance remediation' },
    { id: 'migration', label: 'Migration', description: 'Schema or platform migration' },
    { id: 'test_improvement', label: 'Improve Tests', description: 'Coverage and harness work' },
    { id: 'performance', label: 'Performance', description: 'Speed or resource improvements' },
    {
      id: 'dependency_update',
      label: 'Dependency Update',
      description: 'Library bumps and lockfile work',
    },
  ]);
  app.get('/api/tasks', async (request) =>
    tasks.list((request.query as { projectId?: string }).projectId),
  );
  app.get('/api/tasks/:id', async (request, reply) => {
    const task = tasks.get((request.params as { id: string }).id);
    return task ?? reply.code(404).send({ error: 'Task not found' });
  });
  app.get('/api/tasks/:id/workspace', async (request, reply) => {
    const taskId = (request.params as { id: string }).id;
    if (!tasks.get(taskId)) return reply.code(404).send({ error: 'Task not found' });
    const worktree = worktrees.getByTask(taskId);
    if (!worktree) return { available: false };
    try {
      return await inspectTaskWorkspace(worktree);
    } catch (error) {
      return reply.code(500).send({
        error: error instanceof Error ? error.message : 'Unable to inspect task workspace',
      });
    }
  });
  app.get('/api/tasks/:id/workspace/diff', async (request, reply) => {
    const taskId = (request.params as { id: string }).id;
    if (!tasks.get(taskId)) return reply.code(404).send({ error: 'Task not found' });
    const worktree = worktrees.getByTask(taskId);
    if (!worktree) return reply.code(404).send({ error: 'Task workspace not found' });
    const query = request.query as { path?: string; staged?: string };
    const path = query.path?.trim();
    if (!path) return reply.code(400).send({ error: 'path is required' });
    try {
      return await inspectTaskFileDiff(worktree, path, query.staged === 'true');
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : 'Unable to inspect file diff',
      });
    }
  });
  app.post('/api/tasks/:id/workspace/stage', async (request, reply) => {
    const taskId = (request.params as { id: string }).id;
    const worktree = worktrees.getByTask(taskId);
    if (!worktree) return reply.code(404).send({ error: 'Task workspace not found' });
    if (worktree.writerLeaseId)
      return reply.code(409).send({ error: 'The agent is currently writing to this workspace.' });
    const body = request.body as { paths?: string[]; staged?: boolean };
    try {
      if (body.staged === false) await unstageTaskFiles(worktree, body.paths ?? []);
      else await stageTaskFiles(worktree, body.paths ?? []);
      bus.publish('workspace.changed', { taskId });
      return inspectTaskWorkspace(worktree);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : 'Unable to update staging',
      });
    }
  });
  app.post('/api/tasks/:id/workspace/commit', async (request, reply) => {
    const taskId = (request.params as { id: string }).id;
    const task = tasks.get(taskId);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    if (task.state !== 'accepted')
      return reply.code(409).send({ error: 'Accept the verified result before committing.' });
    const worktree = worktrees.getByTask(taskId);
    if (!worktree) return reply.code(404).send({ error: 'Task workspace not found' });
    if (worktree.writerLeaseId)
      return reply.code(409).send({ error: 'The agent is currently writing to this workspace.' });
    const message = (request.body as { message?: string }).message?.trim();
    if (!message) return reply.code(400).send({ error: 'Commit message is required' });
    try {
      const summary = await inspectTaskWorkspace(worktree);
      if (
        !summary.files.length ||
        summary.files.some((file) => file.worktreeStatus || file.indexStatus === '?')
      ) {
        return reply
          .code(409)
          .send({ error: 'Stage every accepted change before creating the verified commit.' });
      }
      const result = await commitTaskWorkspace(worktree, message);
      audit.append({
        id: randomUUID(),
        actor: 'local-user',
        action: 'workspace.committed',
        targetType: 'task',
        targetId: taskId,
        details: { commit: result.commit, branchName: worktree.branchName },
        createdAt: now(),
      });
      bus.publish('workspace.committed', { taskId, ...result });
      return reply.code(201).send(result);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : 'Unable to commit workspace',
      });
    }
  });
  app.post('/api/tasks/:id/workspace/push', async (request, reply) => {
    const taskId = (request.params as { id: string }).id;
    const task = tasks.get(taskId);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    if (task.state !== 'accepted')
      return reply.code(409).send({ error: 'Accept the verified result before pushing.' });
    const worktree = worktrees.getByTask(taskId);
    if (!worktree) return reply.code(404).send({ error: 'Task workspace not found' });
    if (worktree.writerLeaseId)
      return reply.code(409).send({ error: 'The agent is currently writing to this workspace.' });
    const confirmation = (request.body as { confirmBranch?: string }).confirmBranch;
    if (confirmation !== worktree.branchName)
      return reply.code(400).send({ error: 'Confirm the exact task branch before pushing.' });
    try {
      const summary = await inspectTaskWorkspace(worktree);
      if (summary.files.length)
        return reply.code(409).send({
          error: 'Commit the complete accepted change before pushing this task branch.',
        });
      if (summary.ahead < 1)
        return reply.code(409).send({ error: 'There is no new task commit to push.' });
      const result = await pushTaskWorkspace(worktree);
      audit.append({
        id: randomUUID(),
        actor: 'local-user',
        action: 'workspace.pushed',
        targetType: 'task',
        targetId: taskId,
        details: result,
        createdAt: now(),
      });
      bus.publish('workspace.pushed', { taskId, ...result });
      return result;
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : 'Unable to push workspace',
      });
    }
  });
  app.get('/api/tasks/:id/approvals', async (request) =>
    approvals.listPendingByTask((request.params as { id: string }).id),
  );
  app.get('/api/tasks/:id/documents', async (request, reply) => {
    const task = tasks.get((request.params as { id: string }).id);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    return documents.list(task.id).map((doc) => ({
      id: doc.id,
      taskId: doc.taskId,
      kind: doc.kind,
      authority: doc.authority,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      byteSize: doc.byteSize,
      sha256: doc.sha256,
      extractedTextPreview: doc.extractedText?.slice(0, 280),
      hasExtractedText: Boolean(doc.extractedText),
      createdAt: doc.createdAt,
    }));
  });
  app.post('/api/tasks/:id/documents', async (request, reply) => {
    const task = tasks.get((request.params as { id: string }).id);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    const body = request.body as {
      fileName?: string;
      mimeType?: string;
      authority?: string;
      kind?: string;
      contentBase64?: string;
      content?: string;
    };
    if (!body.fileName || !body.authority || !body.kind) {
      return reply.code(400).send({ error: 'fileName, authority, and kind are required' });
    }
    if (!isDocumentAuthority(body.authority)) {
      return reply.code(400).send({ error: 'Invalid document authority' });
    }
    if (!isDocumentKind(body.kind)) {
      return reply.code(400).send({ error: 'Invalid document kind' });
    }
    let bytes: Buffer;
    try {
      if (body.contentBase64) bytes = Buffer.from(body.contentBase64, 'base64');
      else if (typeof body.content === 'string') bytes = Buffer.from(body.content, 'utf8');
      else return reply.code(400).send({ error: 'content or contentBase64 is required' });
    } catch {
      return reply.code(400).send({ error: 'Invalid document content encoding' });
    }
    try {
      const stored = documents.add({
        taskId: task.id,
        fileName: body.fileName,
        mimeType: body.mimeType,
        authority: body.authority,
        kind: body.kind,
        bytes,
      });
      evidence.addArtefact({
        id: randomUUID(),
        taskId: task.id,
        kind: 'supporting_document',
        path: stored.storagePath,
        contentRef: stored.extractedText?.slice(0, 4_000),
        metadata: {
          documentId: stored.id,
          fileName: stored.fileName,
          authority: stored.authority,
          kind: stored.kind,
          sha256: stored.sha256,
          byteSize: stored.byteSize,
          citation: stored.extractedText
            ? {
                documentId: stored.id,
                fileName: stored.fileName,
                excerpt: stored.extractedText.slice(0, 240),
              }
            : undefined,
        },
        createdAt: now(),
      });
      bus.publish('document.attached', {
        taskId: task.id,
        documentId: stored.id,
        fileName: stored.fileName,
        authority: stored.authority,
      });
      return reply.code(201).send({
        id: stored.id,
        taskId: stored.taskId,
        kind: stored.kind,
        authority: stored.authority,
        fileName: stored.fileName,
        mimeType: stored.mimeType,
        byteSize: stored.byteSize,
        sha256: stored.sha256,
        hasExtractedText: Boolean(stored.extractedText),
        createdAt: stored.createdAt,
      });
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : 'Failed to store document',
      });
    }
  });
  app.post('/api/tasks/:id/start', async (request, reply) => {
    const task = tasks.get((request.params as { id: string }).id);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    // `paused` belongs here: the UI's Resume button posts to this route, and
    // rejecting it left Pause as a one-way door with no way back.
    if (
      task.state !== 'ready' &&
      task.state !== 'failed' &&
      task.state !== 'paused' &&
      task.state !== 'cancelled'
    ) {
      return reply.code(409).send({ error: `Cannot start task in state ${task.state}` });
    }
    const project = projects.get(task.projectId);
    if (!project) return reply.code(400).send({ error: 'Task project missing' });
    try {
      // Show a terminal task as ready while its continuation is prepared.
      if (task.state === 'failed' || task.state === 'cancelled') {
        tasks.upsert({ ...task, state: 'ready', updatedAt: now() });
      }
      const started = await orchestrator.start(
        task,
        project.resolvedPath,
        project.baseBranch,
      );
      return reply.code(202).send({ accepted: true, graphRunId: started.graphRunId });
    } catch (error) {
      return reply.code(500).send({
        error: error instanceof Error ? error.message : 'Failed to start task',
      });
    }
  });
  for (const action of ['pause', 'resume', 'cancel'] as const)
    app.post(`/api/tasks/:id/${action}`, async (request) => {
      orchestrator.control((request.params as { id: string }).id, action);
      return { accepted: true };
    });
  app.post('/api/tasks/:id/stop', async (request) => {
    orchestrator.control((request.params as { id: string }).id, 'stop');
    return { accepted: true };
  });
  app.post('/api/tasks/:id/force-terminate', async (request) => {
    orchestrator.control((request.params as { id: string }).id, 'force-terminate');
    return { accepted: true };
  });
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
    const rows = db
      .prepare(
        `SELECT projection_json FROM active_executions
         WHERE task_id = ? ORDER BY updated_at DESC LIMIT 25`,
      )
      .all(taskId) as Array<{ projection_json: string }>;
    if (!rows.length) return null;
    const executions = rows.map(
      (row) => JSON.parse(row.projection_json) as ActiveExecution,
    );
    const latest = executions[0]!;
    const previous = executions.find(
      (execution) =>
        execution.nodeRunId !== latest.nodeRunId && Boolean(execution.liveOutput?.trim()),
    );
    return {
      ...latest,
      previousTurn: previous
        ? {
            roleDisplayName: previous.roleDisplayName,
            providerDisplayName: previous.providerDisplayName,
            configuredModelDisplayName: previous.configuredModelDisplayName,
            liveOutput: previous.liveOutput!,
          }
        : undefined,
    };
  });
  app.get(
    '/api/runs/:id',
    async (request) =>
      db
        .prepare('SELECT * FROM graph_runs WHERE id = ?')
        .get((request.params as { id: string }).id) ?? null,
  );
  app.get('/api/runs/:id/events', async (request) =>
    db
      .prepare('SELECT * FROM events WHERE aggregate_id = ? ORDER BY sequence')
      .all((request.params as { id: string }).id),
  );
  app.get(
    '/api/runs/:id/active-execution',
    async (request) =>
      db
        .prepare(
          'SELECT projection_json FROM active_executions WHERE graph_run_id = ? ORDER BY updated_at DESC LIMIT 1',
        )
        .get((request.params as { id: string }).id) ?? null,
  );
  for (const action of ['stop', 'force-terminate', 'retry'] as const)
    app.post(`/api/nodes/:id/${action}`, async (request) => {
      const row = db
        .prepare('SELECT task_id FROM active_executions WHERE node_run_id = ?')
        .get((request.params as { id: string }).id) as { task_id?: string } | undefined;
      if (row?.task_id) orchestrator.control(row.task_id, action);
      return { accepted: true };
    });
  app.get('/api/approvals', async () => approvals.listPending());
  for (const decision of ['approve', 'reject'] as const) {
    app.post(`/api/approvals/:id/${decision}`, async (request) => {
      const id = (request.params as { id: string }).id;
      orchestrator.resolveConfirmation(id, decision === 'approve' ? 'approved' : 'rejected');
      return { accepted: true };
    });
  }
  app.post('/api/approval-groups/:id/approve-all-once', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const body = (request.body ?? {}) as { fingerprint?: string };
    const source = approvals.get(id);
    const fingerprint = body.fingerprint ?? source?.fingerprint;
    if (!fingerprint) {
      return reply
        .code(400)
        .send({ error: 'fingerprint is required when confirmation id is unknown' });
    }
    const approved = orchestrator.approveAllByFingerprint(fingerprint);
    audit.append({
      id: randomUUID(),
      actor: 'local-user',
      action: 'approval.approve_all_once',
      targetType: 'confirmation',
      targetId: id,
      details: { fingerprint, approved },
      createdAt: now(),
    });
    return { accepted: true, approved };
  });
  app.get('/api/approval-grants', async (request, reply) => {
    const projectId = (request.query as { projectId?: string }).projectId;
    if (!projectId) return reply.code(400).send({ error: 'projectId is required' });
    return approvalGrants.listByProject(projectId);
  });
  app.post('/api/approval-grants', async (request, reply) => {
    const body = request.body as {
      projectId?: string;
      scope?: string;
      fingerprint?: string;
      requestTypes?: string[];
      maximumRisk?: string;
      expiresAt?: string;
      maximumApplications?: number;
      maximumAdditionalCost?: number;
    };
    if (!body.projectId || !body.scope || !body.maximumRisk || !body.expiresAt) {
      return reply
        .code(400)
        .send({ error: 'projectId, scope, maximumRisk, and expiresAt are required' });
    }
    if (!projects.get(body.projectId)) {
      return reply.code(404).send({ error: 'Project not found' });
    }
    const grant = approvalGrants.create({
      id: randomUUID(),
      projectId: body.projectId,
      scope: body.scope as Parameters<typeof approvalGrants.create>[0]['scope'],
      fingerprint: body.fingerprint,
      requestTypes: body.requestTypes,
      maximumRisk: body.maximumRisk as Parameters<typeof approvalGrants.create>[0]['maximumRisk'],
      maximumApplications: body.maximumApplications,
      maximumAdditionalCost: body.maximumAdditionalCost,
      expiresAt: body.expiresAt,
      createdBy: 'local-user',
      createdAt: now(),
    });
    audit.append({
      id: randomUUID(),
      actor: 'local-user',
      action: 'approval.grant.created',
      targetType: 'approval_grant',
      targetId: grant.id,
      details: { projectId: grant.projectId, scope: grant.scope, fingerprint: grant.fingerprint },
      createdAt: now(),
    });
    bus.publish('approval.grant.created', grant);
    return reply.code(201).send(grant);
  });
  app.post('/api/approval-grants/:id/revoke', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const existing = approvalGrants.get(id);
    if (!existing) return reply.code(404).send({ error: 'Approval grant not found' });
    approvalGrants.revoke(id, now());
    audit.append({
      id: randomUUID(),
      actor: 'local-user',
      action: 'approval.grant.revoked',
      targetType: 'approval_grant',
      targetId: id,
      createdAt: now(),
    });
    return { accepted: true };
  });
  app.get('/api/disclosure-grants', async (request) => {
    const query = request.query as { projectId?: string; providerConnectionId?: string };
    return disclosureGrants.list(query);
  });
  app.post('/api/disclosure-grants', async (request, reply) => {
    const body = request.body as {
      projectId?: string;
      providerConnectionId?: string;
      scope?: Record<string, unknown>;
    };
    if (!body.projectId || !body.providerConnectionId) {
      return reply.code(400).send({ error: 'projectId and providerConnectionId are required' });
    }
    if (!projects.get(body.projectId)) {
      return reply.code(404).send({ error: 'Project not found' });
    }
    try {
      providers.get(body.providerConnectionId);
    } catch {
      return reply.code(404).send({ error: 'Provider not found' });
    }
    const grant = disclosureGrants.create({
      id: randomUUID(),
      projectId: body.projectId,
      providerConnectionId: body.providerConnectionId,
      scope: body.scope ?? { taskBrief: true, documents: true },
      createdAt: now(),
    });
    audit.append({
      id: randomUUID(),
      actor: 'local-user',
      action: 'disclosure.grant.created',
      targetType: 'disclosure_grant',
      targetId: grant.id,
      details: {
        projectId: grant.projectId,
        providerConnectionId: grant.providerConnectionId,
      },
      createdAt: now(),
    });
    return reply.code(201).send(grant);
  });
  app.post('/api/disclosure-grants/:id/revoke', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const existing = disclosureGrants.get(id);
    if (!existing) return reply.code(404).send({ error: 'Disclosure grant not found' });
    disclosureGrants.revoke(id, now());
    audit.append({
      id: randomUUID(),
      actor: 'local-user',
      action: 'disclosure.grant.revoked',
      targetType: 'disclosure_grant',
      targetId: id,
      createdAt: now(),
    });
    return { accepted: true };
  });
  app.get('/api/providers', async () => {
    const listed = await providers.list();
    return listed.map((provider) => {
      const summary = usage.summarizeByProvider(provider.id);
      return {
        ...provider,
        localUsage: {
          entryCount: summary.entryCount,
          inputTokens: summary.inputTokens,
          outputTokens: summary.outputTokens,
          models: usage.summarizeByProviderAndModel(provider.id),
          note: 'RoleFlock local token meter, attributed to this provider and model.',
        },
      };
    });
  });
  app.post('/api/providers', async (request, reply) => {
    const body = request.body as {
      displayName?: string;
      endpoint?: string;
      apiKey?: string;
      model?: string;
      id?: string;
    };
    if (!body.displayName || !body.endpoint || !body.model) {
      return reply.code(400).send({ error: 'displayName, endpoint, and model are required' });
    }
    try {
      const id = customProviderId({ id: body.id, displayName: body.displayName });
      if (providers.has(id) || providerConnections.has(id)) {
        throw new Error(`Provider already registered: ${id}`);
      }
      const apiKeySecretId = body.apiKey ? `provider-api-key:${id}` : undefined;
      if (apiKeySecretId) await providerSecrets.set(apiKeySecretId, body.apiKey ?? '');
      const timestamp = now();
      providerConnections.createCustom({
        id,
        displayName: body.displayName.trim(),
        endpoint: body.endpoint.trim(),
        model: body.model.trim(),
        apiKeySecretId,
        status: 'ready',
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      const registered = providers.registerCustom({
        id,
        displayName: body.displayName,
        endpoint: body.endpoint,
        apiKey: body.apiKey ?? '',
        model: body.model,
      });
      bus.publish('provider.registered', registered);
      return reply.code(201).send(registered);
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : 'Failed to register provider',
      });
    }
  });
  app.post('/api/providers/:id/health-check', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    try {
      const health = await providers.healthCheck(id);
      return { ...health, healthy: health.status === 'ready' };
    } catch {
      return reply.code(404).send({ error: 'Provider not found' });
    }
  });
  app.get('/api/providers/:id/health', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    try {
      return await providers.healthCheck(id);
    } catch {
      return reply.code(404).send({ error: 'Provider not found' });
    }
  });
  app.get('/api/providers/:id/capabilities', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    try {
      return await providers.capabilities(id);
    } catch {
      return reply.code(404).send({ error: 'Provider not found' });
    }
  });
  app.get('/api/providers/:id/models', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    try {
      return await providers.models(id);
    } catch {
      return reply.code(404).send({ error: 'Provider not found' });
    }
  });
  app.get('/api/providers/:id/account', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    try {
      providers.get(id);
      const account = await getProviderAccount(id);
      const summary = usage.summarizeByProvider(id);
      return {
        account,
        localUsage: {
          entryCount: summary.entryCount,
          inputTokens: summary.inputTokens,
          outputTokens: summary.outputTokens,
          models: usage.summarizeByProviderAndModel(id),
          note: 'RoleFlock local token meter, attributed to this provider and model.',
        },
      };
    } catch {
      return reply.code(404).send({ error: 'Provider not found' });
    }
  });
  app.post('/api/providers/:id/auth/:action', async (request, reply) => {
    const { id, action } = request.params as {
      id: string;
      action: string;
    };
    if (!['login', 'logout', 'switch'].includes(action)) {
      return reply.code(400).send({ error: 'action must be login, logout, or switch' });
    }
    try {
      const result = await providers.authAction(id, action as 'login' | 'logout' | 'switch');
      bus.publish('provider.auth', result);
      return result;
    } catch (error) {
      return reply.code(404).send({
        error: error instanceof Error ? error.message : 'Provider not found',
      });
    }
  });
  app.get('/api/evidence/tasks/:taskId', async (request) =>
    evidence.getBundle((request.params as { taskId: string }).taskId),
  );
  app.get('/api/usage/tasks/:taskId', async (request) => {
    const taskId = (request.params as { taskId: string }).taskId;
    const task = tasks.get(taskId);
    const summary = usage.summarize(taskId);
    return {
      scope: 'local-daemon',
      note: 'Local RoleFlock usage only. Actual and shadow costs are never combined into one bill.',
      entries: usage.listByTask(taskId),
      summary: {
        ...summary,
        budget: budgetStatus({
          actualCostUsd: summary.actualCostUsd,
          maxActualCostUsd: task?.maxActualCostUsd,
        }),
      },
    };
  });
  app.get('/api/usage/summary', async () => {
    const summary = db
      .prepare(
        `SELECT COUNT(DISTINCT task_id) AS taskCount,
              COUNT(*) AS entryCount,
              COALESCE(SUM(input_tokens), 0) AS inputTokens,
              COALESCE(SUM(output_tokens), 0) AS outputTokens
       FROM usage_ledger_entries`,
      )
      .get() as {
      taskCount: number;
      entryCount: number;
      inputTokens: number;
      outputTokens: number;
    };
    return {
      scope: 'local-daemon',
      note: 'Locally measured tokens, grouped by the provider and model that consumed them.',
      ...summary,
      byProviderModel: usage.summarizeByProviderAndModel(),
    };
  });
  app.get('/api/price-cards', async () => new PriceCardRepository(db).list());
  app.get('/api/quota', async () =>
    new QuotaSnapshotRepository(db).list().map((row) => ({
      ...row,
      snapshot: JSON.parse(row.snapshotJson) as Record<string, unknown>,
    })),
  );
  app.get('/api/knowledge', async (request) => {
    const query = request.query as {
      projectId?: string;
      type?: string;
      state?: KnowledgeState;
      q?: string;
    };
    return new LocalKnowledgeRepository(db).list(query);
  });
  app.post('/api/knowledge', async (request, reply) => {
    const body = request.body as {
      projectId?: string;
      type?: KnowledgeType;
      title?: string;
      body?: string;
      provenance?: string;
      state?: KnowledgeState;
    };
    if (!body.type || !body.title || !body.body) {
      return reply.code(400).send({ error: 'type, title, and body are required' });
    }
    const item = new LocalKnowledgeRepository(db).create({
      id: randomUUID(),
      projectId: body.projectId,
      type: body.type,
      title: body.title,
      body: body.body,
      provenance: body.provenance,
      state: body.state ?? 'candidate',
      createdAt: now(),
    });
    bus.publish('knowledge.created', item);
    return reply.code(201).send(item);
  });
  app.get('/api/tasks/:id/export/evidence', async (request, reply) => {
    const taskId = (request.params as { id: string }).id;
    if (!tasks.get(taskId)) return reply.code(404).send({ error: 'Task not found' });
    const bundle = buildTaskEvidenceExport(db, taskId);
    audit.append({
      id: randomUUID(),
      actor: 'local-user',
      action: 'export.evidence',
      targetType: 'task',
      targetId: taskId,
      details: { itemCount: bundle.items.length },
      createdAt: now(),
    });
    return bundle;
  });
  app.get('/api/tasks/:id/export/audit', async (request, reply) => {
    const taskId = (request.params as { id: string }).id;
    if (!tasks.get(taskId)) return reply.code(404).send({ error: 'Task not found' });
    const pack = buildTaskAuditExport(db, taskId);
    audit.append({
      id: randomUUID(),
      actor: 'local-user',
      action: 'export.audit',
      targetType: 'task',
      targetId: taskId,
      createdAt: now(),
    });
    return pack;
  });
  app.get('/api/diagnostics/export', async () => {
    const pack = buildDiagnosticsExport(db, dataDir);
    audit.append({
      id: randomUUID(),
      actor: 'local-user',
      action: 'export.diagnostics',
      targetType: 'workspace',
      targetId: 'local',
      createdAt: now(),
    });
    return pack;
  });
  app.post('/api/data/backup', async () => {
    const result = backupLocalData(dataDir);
    audit.append({
      id: randomUUID(),
      actor: 'local-user',
      action: 'data.backup',
      targetType: 'workspace',
      targetId: 'local',
      details: { files: result.files },
      createdAt: now(),
    });
    return result;
  });
  app.post('/api/data/delete', async (request, reply) => {
    const body = request.body as { confirm?: string };
    if (body.confirm !== 'DELETE_LOCAL_DATA') {
      return reply.code(400).send({
        error: 'Send { "confirm": "DELETE_LOCAL_DATA" } to wipe local RoleFlock data',
      });
    }
    audit.append({
      id: randomUUID(),
      actor: 'local-user',
      action: 'data.delete',
      targetType: 'workspace',
      targetId: 'local',
      createdAt: now(),
    });
    db.close();
    const result = deleteLocalData(dataDir);
    return {
      ...result,
      note: 'Local SQLite, documents, and worktrees were wiped. Restart the daemon to continue.',
    };
  });
  app.get('/api/version', async () => getLocalVersion());
  app.get('/api/updates/check', async () => checkForUpdates());
  app.get('/api/privacy', async () => ({
    localOnly: true,
    bind: '127.0.0.1',
    repositoryContentsSent: false,
    updateCheckSendsRepoData: false,
    claims: [
      'Daemon binds to loopback by default.',
      'Exports redact API keys, tokens, and private key material.',
      'Version/update checks must not send repository contents.',
      'Local data can be backed up and deleted from Privacy.',
    ],
  }));
  app.get('/api/roles/contracts', async () => Object.values(ROLE_CONTRACTS));
  app.get('/api/tasks/:id/context-preview', async (request, reply) => {
    const task = tasks.get((request.params as { id: string }).id);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    const role = ((request.query as { role?: string }).role ?? 'planner') as RoleId;
    if (!ROLE_CONTRACTS[role]) return reply.code(400).send({ error: 'Unknown role' });
    const docs = documents.list(task.id);
    const knowledge = new LocalKnowledgeRepository(db).list({
      projectId: task.projectId,
      state: 'published',
    });
    const compiled = compileContext({
      role,
      items: [
        {
          id: `task:${task.id}`,
          source: 'task.brief',
          content: `${task.title}\n${task.brief}`,
          priority: 100,
          sensitivity: 'internal',
        },
        ...docs
          .filter((doc) => doc.extractedText)
          .map((doc) => ({
            id: `document:${doc.id}`,
            source: `document:${doc.fileName}`,
            path: doc.fileName,
            content: doc.extractedText!.slice(0, 2_000),
            priority: 50,
            sensitivity: 'internal' as const,
          })),
        ...knowledge.slice(0, 8).map((item) => ({
          id: `knowledge:${item.id}`,
          source: `knowledge:${item.type}`,
          content: `${item.title}\n${item.body}`,
          priority: 30,
          sensitivity: 'internal' as const,
        })),
      ],
    });
    return {
      role: compiled.role,
      contract: compiled.contract,
      totalTokens: compiled.disclosure.totalTokens,
      totalBytes: compiled.disclosure.totalBytes,
      entries: compiled.disclosure.entries,
      omitted: compiled.omitted,
      exclusions: compiled.disclosure.exclusions,
    };
  });
}
const now = () => new Date().toISOString();
