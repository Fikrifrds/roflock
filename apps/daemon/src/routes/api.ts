import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ActiveExecution, Task } from '@roleflock/contracts';
import {
  availableWorkflowGraphs,
  graphIrToWorkflowGraph,
  registeredWorkflowIr,
  registeredWorkflowSource,
} from '@roleflock/graph-core';
import { isExecutable } from '@roleflock/graph-ir';
import { layoutGraph, toSvg } from '@roleflock/graph-ui';
import { compile } from '@roleflock/language';
import { explainRun } from '@roleflock/evidence';
import {
  AuditRepository,
  ApprovalGrantRepository,
  ChangeContractRepository,
  ConfirmationRepository,
  ConcurrencyPolicyRepository,
  DisclosureGrantRepository,
  EvidenceRepository,
  EventStore,
  LocalKnowledgeRepository,
  PriceCardRepository,
  ProviderConnectionRepository,
  ProjectRepository,
  QuotaSnapshotRepository,
  TaskRepository,
  UsageRepository,
  WorkflowSnapshotRepository,
  WorktreeRepository,
  type KnowledgeState,
  type KnowledgeType,
  type RoleCandidateInput,
  type SqliteDb,
} from '@roleflock/database';
import { compileContext, ROLE_CONTRACTS, type RoleId } from '@roleflock/context-compiler';
import {
  getWorkflowGraph,
  recommendWorkflow,
  resolveWorkflowGraph,
  type WorkflowGraph,
} from '@roleflock/graph-core';
import { budgetStatus } from '@roleflock/usage-ledger';
import { EFFORT_LEVELS, isEffort, stopIsConfirmable } from '@roleflock/provider-core';
import { shippedDriverCancellation } from '../services/cancellation.js';
import {
  DirtyWorkingTreeError,
  initializeEmptyRepository,
  registerRepository,
  releaseInPlaceWorkspace,
  RepositoryRegistrationError,
} from '@roleflock/repository-runtime';
import type { Session } from '../auth.js';
import { EventBus } from '../services/event-bus.js';
import {
  chooseDirectory,
  DirectoryPickerCancelled,
  openDirectory,
} from '../services/directory-picker.js';
import {
  backupLocalData,
  buildDiagnosticsExport,
  buildTaskAuditExport,
  buildTaskEvidenceExport,
  deleteLocalData,
} from '../services/export-service.js';
import { getProviderAccount } from '../services/cli-account.js';
import {
  ConcurrencyLimitError,
  Orchestrator,
  isUnresolvedBillableTurn,
  resolveTaskGraph,
} from '../services/orchestrator.js';
import {
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  ROUTED_ROLES,
  isRoutedRole,
} from '../services/role-defaults.js';
import { customProviderId, ProviderRegistry } from '../services/provider-registry.js';
import { readEnv } from '@roleflock/contracts';
import { DocumentService, isDocumentAuthority, isDocumentKind } from '../services/documents.js';
import { LocalSecretStore } from '../services/local-secret-store.js';
import { checkForUpdates, getLocalVersion } from '../services/version-check.js';
import { discoverVerificationCommand } from '../services/verification-command.js';
import { ReviewAppService } from '../services/review-app.js';
import {
  commitTaskWorkspace,
  inspectTaskFileDiff,
  inspectTaskWorkspace,
  pushTaskWorkspace,
  stageTaskFiles,
  unstageTaskFiles,
} from '../services/task-workspace.js';
import { registerChangeContractRoutes } from './change-contracts.js';
import { registerFeedbackRoutes } from './feedback.js';
import { registerExecutionPlanRoutes } from './execution-plans.js';
import { registerVerificationSpecificationRoutes } from './verification-specifications.js';
import { registerVerificationResultRoutes } from './verification-results.js';
import { registerChangePassportRoutes } from './change-passports.js';
import { registerRoleRecommendationRoutes } from './role-recommendations.js';
import { registerAgentEventRoutes } from './agent-events.js';
import { registerGitHubRoutes } from './github.js';
import { registerOrganisationRoutes } from './organisations.js';
import { registerOutcomeObservationRoutes } from './outcome-observations.js';
import { evaluateContractStartGate } from '../services/contract-start-gate.js';
import { findTaskPathCollisions } from '../services/path-collision.js';
import { buildTaskHandoff } from '../services/task-handoff.js';
import { workflowIrFromSnapshot, workflowSnapshotRecord } from '../services/workflow-snapshot.js';

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
  reviewApps: ReviewAppService,
  runtime: { host: string; port: number; ownerId?: string },
): void {
  const projects = new ProjectRepository(db),
    tasks = new TaskRepository(db),
    workflowSnapshots = new WorkflowSnapshotRepository(db),
    changeContracts = new ChangeContractRepository(db),
    approvals = new ConfirmationRepository(db),
    approvalGrants = new ApprovalGrantRepository(db),
    disclosureGrants = new DisclosureGrantRepository(db),
    evidence = new EvidenceRepository(db),
    events = new EventStore(db),
    usage = new UsageRepository(db),
    providerConnections = new ProviderConnectionRepository(db),
    concurrencyPolicies = new ConcurrencyPolicyRepository(db),
    worktrees = new WorktreeRepository(db),
    audit = new AuditRepository(db);
  registerChangeContractRoutes(app, db, bus);
  registerFeedbackRoutes(app, db, bus);
  registerExecutionPlanRoutes(app, db, bus);
  registerVerificationSpecificationRoutes(app, db, bus);
  registerVerificationResultRoutes(app, db);
  registerChangePassportRoutes(app, db, dataDir);
  registerRoleRecommendationRoutes(app, db, providers, orchestrator.router);
  registerAgentEventRoutes(app, db);
  registerGitHubRoutes(app, db, bus);
  registerOrganisationRoutes(app, db);
  registerOutcomeObservationRoutes(app, db);
  app.get('/api/concurrency-policy', async (request) => {
    const projectId = (request.query as { projectId?: string }).projectId;
    return {
      global: concurrencyPolicies.getGlobal(),
      project: projectId ? concurrencyPolicies.getProject(projectId) : undefined,
      activeTaskIds: concurrencyPolicies.activeTaskIds(projectId),
    };
  });
  app.put('/api/concurrency-policy/global', async (request, reply) => {
    const expectedRevision = parseIfMatch(request.headers['if-match']);
    if (expectedRevision === undefined) {
      return reply.code(428).send({ code: 'IF_MATCH_REQUIRED' });
    }
    try {
      const maxActiveTasks = Number((request.body as { maxActiveTasks?: number }).maxActiveTasks);
      const policy = concurrencyPolicies.set(
        'global',
        '*',
        maxActiveTasks,
        expectedRevision,
        now(),
      );
      bus.publish('concurrency.policy.updated', policy);
      reply.header('etag', `"${policy.revision}"`);
      return policy;
    } catch (error) {
      return reply.code(409).send({
        code: 'CONCURRENCY_POLICY_UPDATE_FAILED',
        error: error instanceof Error ? error.message : 'Concurrency policy update failed',
      });
    }
  });
  app.put('/api/projects/:id/concurrency-policy', async (request, reply) => {
    const projectId = (request.params as { id: string }).id;
    if (projects.get(projectId) === undefined) {
      return reply.code(404).send({ code: 'PROJECT_NOT_FOUND' });
    }
    const expectedRevision = parseIfMatch(request.headers['if-match']);
    if (expectedRevision === undefined) {
      return reply.code(428).send({ code: 'IF_MATCH_REQUIRED' });
    }
    try {
      const maxActiveTasks = Number((request.body as { maxActiveTasks?: number }).maxActiveTasks);
      const policy = concurrencyPolicies.set(
        'project',
        projectId,
        maxActiveTasks,
        expectedRevision,
        now(),
      );
      bus.publish('concurrency.policy.updated', policy);
      reply.header('etag', `"${policy.revision}"`);
      return policy;
    } catch (error) {
      return reply.code(409).send({
        code: 'CONCURRENCY_POLICY_UPDATE_FAILED',
        error: error instanceof Error ? error.message : 'Concurrency policy update failed',
      });
    }
  });
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
  /**
   * What stopping a run can actually promise.
   *
   * Reported rather than assumed by the UI, because the answer is a property of
   * the driver and will change when one can confirm a remote stop. Until then a
   * "Stop" button that implies the work ceased is describing something nobody
   * observed: killing the local CLI says nothing about a request already in
   * flight to a paid API, which keeps running and keeps billing.
   */
  app.get('/api/runtime/cancellation', async () => {
    const capability = await shippedDriverCancellation();
    return { capability, confirmable: stopIsConfirmable(capability) };
  });

  /** The guarantee of the driver turn(s) active on this task right now. */
  app.get('/api/tasks/:id/cancellation', async (request) =>
    orchestrator.cancellationForTask((request.params as { id: string }).id),
  );

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
      forcedProvider: readEnv('FORCE_FAKE') === '1' ? 'fake' : null,
      ...(runtime.ownerId === undefined ? {} : { ownerId: runtime.ownerId }),
    };
  });
  app.get('/api/control/v1', async () => ({
    apiVersion: '1.0',
    product: 'Roflock',
    transport: 'authenticated-loopback-http',
    authentication: {
      sessionFile: 'session.json in the active Roflock data directory (mode 0600)',
      tokenHeader: 'x-roleflock-token',
      csrfHeader: 'x-roleflock-csrf',
      csrfRequiredFor: ['POST'],
      tokenInUrl: false,
    },
    operations: {
      runtimeInfo: { method: 'GET', path: '/api/runtime/info' },
      workflows: { method: 'GET', path: '/api/workflows' },
      registerProject: { method: 'POST', path: '/api/projects' },
      startRun: { method: 'POST', path: '/api/runtime/runs' },
      status: { method: 'GET', path: '/api/runs/{runId}' },
      events: { method: 'GET', path: '/api/runs/{runId}/events?after={sequence}' },
      pause: { method: 'POST', path: '/api/runs/{runId}/pause' },
      resume: { method: 'POST', path: '/api/runs/{runId}/resume' },
      cancel: { method: 'POST', path: '/api/runs/{runId}/cancel' },
      approvals: { method: 'GET', path: '/api/approvals?runId={runId}' },
      approval: { method: 'GET', path: '/api/approvals/{approvalId}' },
      decideApproval: { method: 'POST', path: '/api/approvals/{approvalId}/{approve|reject}' },
      eventStream: { method: 'GET', path: '/api/events/stream' },
    },
    semantics: {
      sourceOfTruth: '.roflock → Graph IR → existing runGraph runtime',
      eventOrdering: 'sequence is monotonic within one run aggregate',
      approval: 'one explicit pending approval ID; no approve-all operation',
      cancellation: '/api/tasks/{taskId}/cancellation reports the active driver guarantee',
    },
  }));
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
  app.post('/api/dialogs/open-directory', async (request, reply) => {
    const body = request.body as { path?: string };
    if (!body.path) return reply.code(400).send({ error: 'path is required' });
    try {
      await openDirectory(body.path);
      return { opened: true };
    } catch (error) {
      return reply.code(500).send({
        error: error instanceof Error ? error.message : 'Failed to open folder',
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
    const existing = projects.getByResolvedPath(repository.root);
    if (existing) return reply.code(200).send({ ...existing, gitInitialized: false });
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
    let workflowGraph: WorkflowGraph;
    try {
      workflowGraph = resolveWorkflowGraph(mode);
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
      workflowGraphVersionId: workflowGraph.version,
      budgetPolicyId: 'local-default',
      contractRequirement: 'required',
      expectedBehaviour: body.expectedBehaviour,
      actualBehaviour: body.actualBehaviour,
      verificationCommand: body.verificationCommand,
      maxAttempts: body.maxAttempts ?? 3,
      maxActualCostUsd: body.maxActualCostUsd,
      createdAt: now(),
      updatedAt: now(),
    };
    const ir = registeredWorkflowIr(mode);
    const source = registeredWorkflowSource(mode);
    const snapshot = workflowSnapshotRecord({
      taskId: task.id,
      graph: workflowGraph,
      ...(ir === undefined ? {} : { ir }),
      ...(source === undefined ? {} : { source }),
      createdAt: task.createdAt,
    });
    db.transaction(() => {
      tasks.upsert(task);
      workflowSnapshots.create(snapshot);
    })();
    bus.publish('task.created', task);
    return reply.code(201).send(task);
  });
  app.post('/api/runtime/runs', async (request, reply) => {
    const body = request.body as {
      projectId?: string;
      source?: string;
      title?: string;
      brief?: string;
      type?: Task['type'];
      risk?: Task['risk'];
      allowUncontracted?: boolean;
    };
    if (!body.projectId || !body.source || !body.brief) {
      return reply.code(400).send({
        error: 'projectId, source, and brief are required',
      });
    }
    if (body.allowUncontracted !== true) {
      return reply.code(409).send({
        code: 'CHANGE_CONTRACT_REQUIRED',
        error:
          'Runtime CLI execution requires explicit allowUncontracted=true until a Change Contract is supplied.',
      });
    }
    if (Buffer.byteLength(body.source, 'utf8') > 1_048_576) {
      return reply
        .code(413)
        .send({ error: 'Workflow source exceeds the 1 MiB local runtime limit' });
    }
    const project = projects.get(body.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });

    const compiled = compile(body.source, { uri: 'cli://workflow.roflock' });
    if (!compiled.ir || !isExecutable(compiled.diagnostics)) {
      return reply.code(422).send({
        code: 'WORKFLOW_INVALID',
        error: 'Workflow did not compile to executable Graph IR',
        diagnostics: compiled.diagnostics,
      });
    }
    const bridged = graphIrToWorkflowGraph(compiled.ir);
    if (!bridged.graph) {
      return reply.code(422).send({
        code: 'WORKFLOW_NOT_EXECUTABLE',
        error: 'Workflow cannot execute on this runtime',
        diagnostics: bridged.diagnostics,
      });
    }

    const createdAt = now();
    const task: Task = {
      id: randomUUID(),
      projectId: project.id,
      type: body.type ?? 'feature',
      title: body.title?.trim() || compiled.ir.workflow.name || compiled.ir.workflow.id,
      brief: body.brief,
      risk: body.risk ?? 'medium',
      state: 'ready',
      workflowGraphVersionId: bridged.graph.version,
      budgetPolicyId: 'local-default',
      contractRequirement: 'legacy_uncontracted',
      maxAttempts: 3,
      createdAt,
      updatedAt: createdAt,
    };
    const snapshot = workflowSnapshotRecord({
      taskId: task.id,
      graph: bridged.graph,
      ir: compiled.ir,
      source: body.source,
      createdAt,
    });
    db.transaction(() => {
      tasks.upsert(task);
      workflowSnapshots.create(snapshot);
    })();
    bus.publish('task.created', task);

    try {
      const started = await orchestrator.start(task, project.resolvedPath, project.baseBranch);
      const warning = evaluateContractStartGate(task, changeContracts);
      return reply.code(202).send({
        accepted: true,
        taskId: task.id,
        graphRunId: started.graphRunId,
        workflowId: compiled.ir.workflow.id,
        semanticHash: snapshot.semanticHash,
        contract:
          warning.allowed && warning.mode === 'legacy_uncontracted'
            ? { mode: warning.mode, warning: warning.warning }
            : undefined,
      });
    } catch (error) {
      if (error instanceof ConcurrencyLimitError) {
        return reply.code(409).send({
          code: 'CONCURRENCY_LIMIT_REACHED',
          error: error.message,
          scope: error.scope,
          activeCount: error.activeCount,
          limit: error.limit,
        });
      }
      return reply.code(422).send({
        code: 'RUN_START_FAILED',
        error: error instanceof Error ? error.message : 'Failed to start workflow',
        taskId: task.id,
      });
    }
  });
  app.get('/api/tasks/:id/verification-suggestion', async (request, reply) => {
    const taskId = (request.params as { id: string }).id;
    const task = tasks.get(taskId);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    const project = projects.get(task.projectId);
    if (!project) return reply.code(404).send({ error: 'Project not found' });
    const worktree = worktrees.getByTask(taskId);
    return {
      command: await discoverVerificationCommand(
        worktree && existsSync(worktree.path) ? worktree.path : project.resolvedPath,
      ),
    };
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
    availableWorkflowGraphs().map((graph) => ({
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
      graph = resolveTaskGraph(task, workflowSnapshots.get(task.id));
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

    /**
     * Nodes holding a paid turn whose result nobody observed (ADR-010).
     *
     * Decided by the same predicate the orchestrator halts on, against the same
     * rows — not by matching the halt message, which would make a user-facing
     * warning depend on wording nobody would think to keep stable.
     */
    const unresolvedNodes = new Set<string>();
    if (run) {
      const invocations = db
        .prepare(
          `SELECT node_runs.node_key AS node_key,
                  invocations.status AS status,
                  invocations.outcome AS outcome,
                  invocations.provider_connection_id AS provider_connection_id
             FROM invocations
             JOIN node_runs ON node_runs.id = invocations.node_run_id
            WHERE node_runs.graph_run_id = ?`,
        )
        .all(run.id) as Array<{
        node_key: string;
        status: string;
        outcome: string | null;
        provider_connection_id: string;
      }>;
      for (const invocation of invocations) {
        if (
          isUnresolvedBillableTurn({
            status: invocation.status,
            providerConnectionId: invocation.provider_connection_id,
            ...(invocation.outcome === null ? {} : { outcome: invocation.outcome }),
          })
        ) {
          unresolvedNodes.add(invocation.node_key);
        }
      }
    }

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

    // Graph rendering must stay instant. Provider health and `listModels` can
    // hang for tens of seconds; the map only needs configured route labels.
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
            primaryProviderDisplayName: primary
              ? providers.displayName(primary.providerConnectionId)
              : null,
            primaryModelId: primary?.modelId ?? null,
            primaryModelDisplayName: primary?.modelId ?? null,
            state: latest.get(node.id)?.state ?? unreachedState,
            outcome: latest.get(node.id)?.outcome ?? null,
            unresolvedInvocation: unresolvedNodes.has(node.id),
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
  app.get('/api/tasks/:id/handoff', async (request, reply) => {
    const taskId = (request.params as { id: string }).id;
    try {
      return buildTaskHandoff(db, taskId, now());
    } catch (error) {
      return reply.code(409).send({
        code: 'TASK_HANDOFF_NOT_READY',
        error: error instanceof Error ? error.message : 'Task handoff is not ready',
      });
    }
  });
  app.post('/api/tasks/:id/handoff/open-folder', async (request, reply) => {
    const taskId = (request.params as { id: string }).id;
    try {
      const handoff = buildTaskHandoff(db, taskId, now());
      await openDirectory(handoff.manifest.workspace.path);
      bus.publish('task.handoff.opened', {
        taskId,
        tool: 'folder',
        handoffHash: handoff.manifest.hash,
        contractHash: handoff.manifest.authority.contractHash,
        planHash: handoff.manifest.authority.planHash,
      });
      return { opened: true, handoffHash: handoff.manifest.hash };
    } catch (error) {
      return reply.code(409).send({
        code: 'TASK_HANDOFF_FAILED',
        error: error instanceof Error ? error.message : 'Task handoff failed',
      });
    }
  });
  app.get('/api/tasks/:id/workspace', async (request, reply) => {
    const taskId = (request.params as { id: string }).id;
    const task = tasks.get(taskId);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    const worktree = worktrees.getByTask(taskId);
    if (!worktree) return { available: false };
    const project = projects.get(task.projectId);
    try {
      const summary = await inspectTaskWorkspace(worktree);
      return {
        ...summary,
        inPlace: Boolean(project && worktree.path === project.resolvedPath),
      };
    } catch (error) {
      return reply.code(500).send({
        error: error instanceof Error ? error.message : 'Unable to inspect task workspace',
      });
    }
  });
  app.get('/api/tasks/:id/review-app', async (request, reply) => {
    const taskId = (request.params as { id: string }).id;
    if (!tasks.get(taskId)) return reply.code(404).send({ error: 'Task not found' });
    const worktree = worktrees.getByTask(taskId);
    if (!worktree)
      return { available: false, detail: 'Start this task to create a review workspace.' };
    return reviewApps.inspect(taskId, worktree.path);
  });
  app.post('/api/tasks/:id/review-app/start', async (request, reply) => {
    const taskId = (request.params as { id: string }).id;
    if (!tasks.get(taskId)) return reply.code(404).send({ error: 'Task not found' });
    const worktree = worktrees.getByTask(taskId);
    if (!worktree) return reply.code(404).send({ error: 'Task workspace not found' });
    if (worktree.writerLeaseId)
      return reply
        .code(409)
        .send({ error: 'Wait until the writer finishes before starting a review preview.' });
    try {
      const preview = await reviewApps.start(taskId, worktree.path);
      audit.append({
        id: randomUUID(),
        actor: 'local-user',
        action: 'review_app.started',
        targetType: 'task',
        targetId: taskId,
        details: { mode: preview.mode, command: preview.command },
        createdAt: now(),
      });
      return preview;
    } catch (error) {
      return reply.code(400).send({
        error: error instanceof Error ? error.message : 'Unable to start review preview',
      });
    }
  });
  app.post('/api/tasks/:id/review-app/stop', async (request, reply) => {
    const taskId = (request.params as { id: string }).id;
    if (!tasks.get(taskId)) return reply.code(404).send({ error: 'Task not found' });
    await reviewApps.stop(taskId);
    return { ok: true };
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
  const startTask = async (taskId: string, reply: FastifyReply) => {
    const task = tasks.get(taskId);
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
    const contractGate = evaluateContractStartGate(task, changeContracts);
    if (!contractGate.allowed) {
      return reply.code(409).send({
        code: contractGate.code,
        error: contractGate.message,
        contractId: contractGate.contractId,
        contractStatus: contractGate.contractStatus,
        revision: contractGate.revision,
      });
    }
    const project = projects.get(task.projectId);
    if (!project) return reply.code(400).send({ error: 'Task project missing' });
    try {
      const collisionWarnings = findTaskPathCollisions(db, task.id);
      if (collisionWarnings.length > 0) {
        bus.publish('task.path_collision.predicted', {
          taskId: task.id,
          projectId: task.projectId,
          collisions: collisionWarnings,
        });
      }
      // Show a terminal task as ready while its continuation is prepared.
      if (task.state === 'failed' || task.state === 'cancelled') {
        tasks.upsert({ ...task, state: 'ready', updatedAt: now() });
      }
      const started = await orchestrator.start(task, project.resolvedPath, project.baseBranch);
      return reply.code(202).send({
        accepted: true,
        graphRunId: started.graphRunId,
        collisionWarnings,
        contract:
          contractGate.mode === 'authorised'
            ? contractGate.pin
            : {
                mode: contractGate.mode,
                warning: contractGate.warning,
              },
      });
    } catch (error) {
      if (error instanceof ConcurrencyLimitError) {
        return reply.code(409).send({
          code: 'CONCURRENCY_LIMIT_REACHED',
          error: error.message,
          scope: error.scope,
          activeCount: error.activeCount,
          limit: error.limit,
        });
      }
      if (error instanceof DirtyWorkingTreeError) {
        return reply.code(409).send({ error: error.message });
      }
      const message = error instanceof Error ? error.message : 'Failed to start task';
      if (/already used by another RoleFlock task/i.test(message)) {
        return reply.code(409).send({ error: message });
      }
      return reply.code(500).send({ error: message });
    }
  };
  app.post('/api/tasks/:id/start', async (request, reply) =>
    startTask((request.params as { id: string }).id, reply),
  );
  app.post('/api/tasks/:id/resume', async (request, reply) =>
    startTask((request.params as { id: string }).id, reply),
  );
  for (const action of ['pause', 'cancel'] as const)
    app.post(`/api/tasks/:id/${action}`, async (request, reply) => {
      const taskId = (request.params as { id: string }).id;
      if (!tasks.get(taskId)) return reply.code(404).send({ error: 'Task not found' });
      try {
        return await orchestrator.control(taskId, action);
      } catch (error) {
        return reply.code(409).send({
          error: error instanceof Error ? error.message : `Cannot ${action} task`,
        });
      }
    });
  app.post('/api/tasks/:id/stop', async (request) => {
    return orchestrator.control((request.params as { id: string }).id, 'stop');
  });
  app.post('/api/tasks/:id/force-terminate', async (request) => {
    return orchestrator.control((request.params as { id: string }).id, 'force-terminate');
  });
  for (const action of ['accept', 'reject'] as const) {
    app.post(`/api/tasks/:id/${action}`, async (request, reply) => {
      const task = tasks.get((request.params as { id: string }).id);
      if (!task) return reply.code(404).send({ error: 'Task not found' });
      // Awaited so the passport exists before the client refetches the task.
      await orchestrator.resolveAcceptance(task.id, action === 'accept' ? 'accepted' : 'rejected');
      return { accepted: true };
    });
  }
  app.delete('/api/tasks/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const task = tasks.get(id);
    if (!task) return reply.code(404).send({ error: 'Task not found' });
    if (
      orchestrator.isActive(id) ||
      task.state === 'running' ||
      task.state === 'stopping' ||
      task.state === 'paused' ||
      task.state === 'awaiting_confirmation' ||
      task.state === 'awaiting_acceptance'
    ) {
      return reply.code(409).send({
        error: 'Stop or finish the task before deleting it',
      });
    }

    const worktree = worktrees.getByTask(id);
    const project = projects.get(task.projectId);
    try {
      await reviewApps.stop(id);
    } catch {
      /* preview may already be gone */
    }

    if (worktree && project && worktree.path === project.resolvedPath) {
      try {
        await releaseInPlaceWorkspace(
          worktree.path,
          worktree.branchName,
          project.baseBranch === 'HEAD' ? 'main' : project.baseBranch,
        );
      } catch {
        /* leave the checkout as-is; branch history remains for the user */
      }
    }

    const deleted = tasks.delete(id);
    if (!deleted) return reply.code(404).send({ error: 'Task not found' });

    const externalRoot = join(dataDir, 'worktrees');
    if (
      worktree?.path &&
      existsSync(worktree.path) &&
      worktree.path.startsWith(externalRoot + '/') &&
      worktree.path !== project?.resolvedPath
    ) {
      try {
        rmSync(worktree.path, { recursive: true, force: true });
      } catch {
        /* leaving a stale external worktree dir is recoverable */
      }
    }

    audit.append({
      id: randomUUID(),
      actor: 'local-user',
      action: 'task.delete',
      targetType: 'task',
      targetId: id,
      details: { title: task.title, state: task.state },
      createdAt: now(),
    });
    bus.publish('task.deleted', { id, title: task.title });
    return { deleted: true, id };
  });
  app.get('/api/tasks/:id/active-execution', async (request) => {
    const taskId = (request.params as { id: string }).id;
    const rows = db
      .prepare(
        `SELECT projection_json FROM active_executions
         WHERE task_id = ? ORDER BY updated_at DESC LIMIT 25`,
      )
      .all(taskId) as Array<{ projection_json: string }>;
    if (!rows.length) return null;
    const executions = rows.map((row) => JSON.parse(row.projection_json) as ActiveExecution);
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
  app.get('/api/runs/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const row = db.prepare('SELECT * FROM graph_runs WHERE id = ?').get(id) as
      Record<string, unknown> | undefined;
    if (!row) return reply.code(404).send({ error: 'Run not found' });
    const nodeCounts = db
      .prepare(
        `SELECT state, COUNT(*) AS count FROM node_runs
         WHERE graph_run_id = ? GROUP BY state ORDER BY state`,
      )
      .all(id) as Array<{ state: string; count: number }>;
    return {
      id: String(row.id),
      taskId: String(row.task_id),
      graphVersionId: String(row.graph_version_id),
      state: String(row.state),
      startedAt: row.started_at ? String(row.started_at) : undefined,
      completedAt: row.completed_at ? String(row.completed_at) : undefined,
      createdAt: String(row.created_at),
      blockedRole: row.blocked_role ? String(row.blocked_role) : undefined,
      blockedReason: row.blocked_reason ? String(row.blocked_reason) : undefined,
      blockedDetail: row.blocked_detail ? String(row.blocked_detail) : undefined,
      nodeCounts: Object.fromEntries(nodeCounts.map((entry) => [entry.state, entry.count])),
    };
  });
  app.get('/api/runs/:id/events', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const exists = db.prepare('SELECT 1 FROM graph_runs WHERE id = ?').get(id);
    if (!exists) return reply.code(404).send({ error: 'Run not found' });
    const after = Number((request.query as { after?: string }).after ?? 0);
    if (!Number.isInteger(after) || after < 0) {
      return reply.code(400).send({ error: 'after must be a non-negative integer' });
    }
    return events.list(id, after);
  });
  for (const action of ['pause', 'resume', 'cancel'] as const) {
    app.post(`/api/runs/:id/${action}`, async (request, reply) => {
      const runId = (request.params as { id: string }).id;
      const run = db.prepare('SELECT task_id FROM graph_runs WHERE id = ?').get(runId) as
        { task_id: string } | undefined;
      if (!run) return reply.code(404).send({ error: 'Run not found' });
      const latest = db
        .prepare(
          'SELECT id FROM graph_runs WHERE task_id = ? ORDER BY created_at DESC, id DESC LIMIT 1',
        )
        .get(run.task_id) as { id: string } | undefined;
      if (latest?.id !== runId) {
        return reply.code(409).send({
          error: `Run ${runId} is historical and cannot control the current task execution`,
        });
      }
      const task = tasks.get(run.task_id);
      if (!task) return reply.code(404).send({ error: 'Task not found' });
      if (action === 'resume') return startTask(task.id, reply);
      const allowed =
        action === 'pause'
          ? ['running', 'awaiting_confirmation', 'awaiting_acceptance'].includes(task.state)
          : [
              'running',
              'paused',
              'awaiting_confirmation',
              'awaiting_acceptance',
              'stopping',
            ].includes(task.state);
      if (!allowed) {
        return reply.code(409).send({
          error: `Cannot ${action} run in task state ${task.state}`,
        });
      }
      try {
        return await orchestrator.control(task.id, action);
      } catch (error) {
        return reply.code(409).send({
          error: error instanceof Error ? error.message : `Cannot ${action} run`,
        });
      }
    });
  }
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
      return row?.task_id ? orchestrator.control(row.task_id, action) : { accepted: true as const };
    });
  app.get('/api/approvals', async (request) => {
    const query = request.query as { runId?: string; taskId?: string };
    return approvals
      .listPending()
      .filter((approval) => query.runId === undefined || approval.graphRunId === query.runId)
      .filter((approval) => query.taskId === undefined || approval.taskId === query.taskId);
  });
  app.get('/api/approvals/:id', async (request, reply) => {
    const approval = approvals.get((request.params as { id: string }).id);
    return approval ?? reply.code(404).send({ error: 'Approval not found' });
  });
  for (const decision of ['approve', 'reject'] as const) {
    app.post(`/api/approvals/:id/${decision}`, async (request, reply) => {
      const id = (request.params as { id: string }).id;
      const approval = approvals.get(id);
      if (!approval) return reply.code(404).send({ error: 'Approval not found' });
      if (approval.status !== 'pending') {
        return reply.code(409).send({
          error: `Approval ${id} is already ${approval.status}`,
        });
      }
      orchestrator.resolveConfirmation(id, decision === 'approve' ? 'approved' : 'rejected');
      return { accepted: true, approval: approvals.get(id) };
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
  app.get('/api/providers', async (request) => {
    const query = request.query as { fresh?: string };
    const listed = await providers.list({ fresh: query.fresh === '1' || query.fresh === 'true' });
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
  /**
   * The shared layout for a task's workflow, with live node state overlaid.
   *
   * Serves the same model `roflock render` and the Playground draw from, so
   * Studio's diagram cannot drift from what the CLI shows. Only available for a
   * compiled template: a hard-coded built-in has no IR to lay out, and inventing
   * one would reintroduce the second implementation this replaces.
   */
  app.get('/api/tasks/:taskId/diagram', async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    const task = tasks.get(taskId);
    if (!task) return reply.code(404).send({ error: 'Task not found' });

    const snapshot = workflowSnapshots.get(task.id);
    let graph: WorkflowGraph;
    let ir;
    try {
      graph = resolveTaskGraph(task, snapshot);
      ir =
        snapshot === undefined
          ? registeredWorkflowIr(graph.version)
          : workflowIrFromSnapshot(snapshot);
    } catch (error) {
      return reply.code(409).send({
        error: error instanceof Error ? error.message : 'Invalid workflow snapshot',
      });
    }
    if (ir === undefined) {
      return reply.code(409).send({
        error: 'No compiled workflow for this task',
        detail:
          'This task runs a hard-coded template, which has no Graph IR to lay out. Diagrams are available for workflows compiled from .roflock source.',
        graphVersionId: graph.version,
      });
    }

    const run = db
      .prepare('SELECT id FROM graph_runs WHERE task_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(taskId) as { id: string } | undefined;
    const nodeStates =
      run === undefined
        ? []
        : (db
            .prepare('SELECT node_key, state, outcome FROM node_runs WHERE graph_run_id = ?')
            .all(run.id) as Array<{ node_key: string; state: string; outcome: string | null }>);

    const state: Record<string, { state: 'pending' | 'running' | 'settled'; outcome?: string }> =
      {};
    for (const row of nodeStates) {
      state[row.node_key] = {
        state: row.state === 'running' ? 'running' : 'settled',
        ...(row.outcome === null ? {} : { outcome: row.outcome }),
      };
    }

    return {
      graphVersionId: graph.version,
      // The source as it is on disk, not a reconstruction — a regenerated one
      // would be a second rendering of the same graph and could disagree with
      // the file the operator is editing.
      source:
        snapshot === undefined
          ? (registeredWorkflowSource(graph.version) ?? null)
          : (snapshot.source ?? null),
      semanticHash: ir.workflow.semanticHash ?? null,
      layout: layoutGraph(ir, { state }),
      svg: toSvg(layoutGraph(ir, { state })),
    };
  });

  /**
   * The evidence chain, with its gaps named.
   *
   * Distinct from the bundle below, which lists what exists. This answers "why
   * should I believe this change is safe?" — and the difference that matters is
   * that it reports what is *missing*. A view built only from the bundle shows a
   * run with no verification as a run that needed none.
   */
  app.get('/api/evidence/tasks/:taskId/chain', async (request, reply) => {
    const taskId = (request.params as { taskId: string }).taskId;
    if (!tasks.get(taskId)) return reply.code(404).send({ error: 'Task not found' });
    return explainRun(db, taskId);
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
    const result = await backupLocalData(db, dataDir);
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

function parseIfMatch(value: string | string[] | undefined): number | undefined {
  if (typeof value !== 'string') return undefined;
  const revision = Number(value.replaceAll('"', ''));
  return Number.isInteger(revision) && revision > 0 ? revision : undefined;
}
const now = () => new Date().toISOString();
