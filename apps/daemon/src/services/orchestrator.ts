import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync } from 'node:fs';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ActiveExecution, ConfirmationRequest, Task } from '@roleflock/contracts';
import { createConfirmationRequest, matchingGrant } from '@roleflock/approval-engine';
import {
  buildRepositoryMap,
  compileContext,
  type RoleId,
} from '@roleflock/context-compiler';
import {
  ActiveExecutionRepository,
  ApprovalGrantRepository,
  AuditRepository,
  ConfirmationRepository,
  ControlCommandRepository,
  EvidenceRepository,
  EventStore,
  InvocationRepository,
  LeaseRepository,
  LocalKnowledgeRepository,
  ProcessHandleRepository,
  TaskRepository,
  UsageRepository,
  WorktreeRepository,
  type SqliteDb,
} from '@roleflock/database';
import { runCommand, CommandError } from '@roleflock/command-runner';
import { getWorkflowGraph, validateGraph, type WorkflowGraph } from '@roleflock/graph-core';
import { runSequentialGraph } from '@roleflock/graph-runtime';
import {
  captureDiff,
  createWorktree,
  registerRepository,
  WriterLease,
} from '@roleflock/repository-runtime';
import { FakeProvider, type ProviderAdapter } from '@roleflock/provider-core';
import { CursorWriterAdapter } from '@roleflock/provider-cursor';
import { budgetStatus, estimateInvocationCost } from '@roleflock/usage-ledger';
import { EventBus } from './event-bus.js';
import {
  authoritativeConflictMessage,
  type DocumentService,
} from './documents.js';
import { loadPriceCards } from './pricing.js';
import type { ProviderRegistry } from './provider-registry.js';
import { routeRole, type RoleRoute, type RoutedRole } from './role-routing.js';

interface PreparedRun {
  graphRunId: string;
  graph: WorkflowGraph;
  worktreePath: string;
  baseCommit: string;
}

interface VerificationSpec {
  command: string;
  args: string[];
  label: string;
}

export class Orchestrator {
  private readonly active = new Map<string, AbortController>();
  private readonly acceptanceWaiters = new Map<
    string,
    { resolve: (decision: 'accepted' | 'rejected') => void }
  >();
  private readonly confirmationWaiters = new Map<
    string,
    { resolve: (decision: 'approved' | 'rejected') => void }
  >();
  private readonly tasks: TaskRepository;
  private readonly executions: ActiveExecutionRepository;
  private readonly commands: ControlCommandRepository;
  private readonly evidence: EvidenceRepository;
  private readonly usage: UsageRepository;
  private readonly worktrees: WorktreeRepository;
  private readonly events: EventStore;
  private readonly confirmations: ConfirmationRepository;
  private readonly invocations: InvocationRepository;
  private readonly leases: LeaseRepository;
  private readonly processHandles: ProcessHandleRepository;
  private readonly worktreeBaseDir: string;
  private readonly providers?: ProviderRegistry;
  private readonly documents?: DocumentService;
  private readonly forceFake: boolean;
  private readonly documentConflictResolved = new Set<string>();

  constructor(
    private readonly db: SqliteDb,
    private readonly bus: EventBus,
    worktreeBaseDir: string,
    providers?: ProviderRegistry,
    documents?: DocumentService,
  ) {
    this.tasks = new TaskRepository(db);
    this.executions = new ActiveExecutionRepository(db);
    this.commands = new ControlCommandRepository(db);
    this.evidence = new EvidenceRepository(db);
    this.usage = new UsageRepository(db);
    this.worktrees = new WorktreeRepository(db);
    this.events = new EventStore(db);
    this.confirmations = new ConfirmationRepository(db);
    this.invocations = new InvocationRepository(db);
    this.leases = new LeaseRepository(db);
    this.processHandles = new ProcessHandleRepository(db);
    this.worktreeBaseDir = worktreeBaseDir;
    this.providers = providers;
    this.documents = documents;
    this.forceFake = process.env.ROLEFLOCK_FORCE_FAKE === '1';
    mkdirSync(worktreeBaseDir, { recursive: true });
  }

  /** Awaits setup only; graph continues in background. */
  async start(
    task: Task,
    repositoryPath: string,
    baseBranch: string,
  ): Promise<{ graphRunId: string }> {
    if (this.active.has(task.id)) throw new Error('Task is already running');
    const controller = new AbortController();
    this.active.set(task.id, controller);

    try {
      const prepared = await this.prepareRun(task, repositoryPath, baseBranch);
      void this.executeGraph(task, prepared, controller)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Task execution failed';
          this.recordFailure(task.id, 'Task failed', message);
          if (!controller.signal.aborted) this.setTaskState(task.id, 'failed');
        })
        .finally(() => {
          this.active.delete(task.id);
        });
      return { graphRunId: prepared.graphRunId };
    } catch (error) {
      this.active.delete(task.id);
      const message = error instanceof Error ? error.message : 'Task failed to start';
      this.recordFailure(task.id, 'Task failed to start', message);
      this.setTaskState(task.id, 'failed');
      throw error;
    }
  }

  control(taskId: string, commandType: string): void {
    const execution = this.executions.getByTask(taskId);
    if (!execution) throw new Error('No active execution for task');
    const id = randomUUID();
    const nowIso = now();
    this.commands.create({
      id,
      nodeRunId: execution.nodeRunId,
      commandType,
      commandVersion: 1,
      status: 'requested',
      requestedAt: nowIso,
    });
    this.commands.updateStatus(id, 'acknowledged', { acknowledgedAt: now() });
    if (commandType === 'pause') {
      execution.pauseRequested = true;
      this.executions.upsert(execution);
      this.setTaskState(taskId, 'paused');
    }
    if (commandType === 'stop' || commandType === 'cancel') {
      execution.stopRequested = true;
      this.executions.upsert(execution);
      this.active.get(taskId)?.abort();
    }
    if (commandType === 'force-terminate') {
      execution.stopRequested = true;
      this.executions.upsert(execution);
      this.active.get(taskId)?.abort();
      this.forceKillTaskProcesses(taskId, execution.nodeRunId);
    }
    if (commandType === 'cancel') {
      const wt = this.worktrees.getByTask(taskId);
      if (wt) this.worktrees.setStatus(taskId, 'dirty_preserved');
      this.setTaskState(taskId, 'cancelled');
    }
    this.commands.updateStatus(id, 'completed', { completedAt: now() });
    this.bus.publish('control.commanded', { taskId, commandType });
  }

  resolveAcceptance(taskId: string, decision: 'accepted' | 'rejected'): void {
    this.setTaskState(taskId, decision);
    this.acceptanceWaiters.get(taskId)?.resolve(decision);
    this.acceptanceWaiters.delete(taskId);
  }

  resolveConfirmation(id: string, decision: 'approved' | 'rejected'): void {
    this.confirmations.setStatus(id, decision === 'approved' ? 'approved' : 'rejected', now());
    this.confirmationWaiters.get(id)?.resolve(decision);
    this.confirmationWaiters.delete(id);
    const request = this.confirmations.get(id);
    if (request) this.setTaskState(request.taskId, 'running');
  }

  approveAllByFingerprint(fingerprint: string): number {
    const pending = this.confirmations.listByFingerprint(fingerprint, 'pending');
    for (const request of pending) {
      this.resolveConfirmation(request.id, 'approved');
    }
    return pending.length;
  }

  private async prepareRun(
    task: Task,
    repositoryPath: string,
    baseBranch: string,
  ): Promise<PreparedRun> {
    const graphRunId = randomUUID();
    const graphMode =
      task.workflowGraphVersionId === 'direct' ||
      task.workflowGraphVersionId === 'fast' ||
      task.workflowGraphVersionId === 'standard' ||
      task.workflowGraphVersionId === 'bug_fix' ||
      task.workflowGraphVersionId === 'critical'
        ? task.workflowGraphVersionId
        : task.type === 'bug_fix'
          ? 'bug_fix'
          : 'standard';
    const graph = getWorkflowGraph(graphMode);
    const graphErrors = validateGraph(graph);
    if (graphErrors.length) {
      throw new Error(`Invalid workflow graph: ${graphErrors.join(', ')}`);
    }
    const repo = await registerRepository(repositoryPath);
    let worktree;
    try {
      worktree = await createWorktree(repo, task.id, {
        baseRef: baseBranch === 'HEAD' ? 'HEAD' : baseBranch,
        worktreeBaseDir: this.worktreeBaseDir,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to create Git worktree: ${detail}`);
    }

    this.db
      .prepare(
        'INSERT INTO graph_runs (id, task_id, graph_version_id, state, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(graphRunId, task.id, graph.id, 'running', now(), now());
    this.worktrees.create({
      id: randomUUID(),
      taskId: task.id,
      projectId: task.projectId,
      path: worktree.path,
      branchName: worktree.branchName,
      baseCommit: worktree.baseCommit,
      status: 'active',
      createdAt: now(),
    });
    this.setTaskState(task.id, 'running');
    const bootstrapNode = graph.nodes[0]?.id ?? 'planner';
    this.updateExecution(task, graphRunId, randomUUID(), bootstrapNode, 'preparing');
    this.bus.publish('task.started', { taskId: task.id, graphRunId });
    return {
      graphRunId,
      graph,
      worktreePath: worktree.path,
      baseCommit: worktree.baseCommit,
    };
  }

  private async executeGraph(
    task: Task,
    prepared: PreparedRun,
    controller: AbortController,
  ): Promise<void> {
    const { graphRunId, graph, worktreePath, baseCommit } = prepared;
    let attempt = 0;

    const results = await runSequentialGraph(graph, async (role) => {
      if (controller.signal.aborted) throw new Error('Cancelled by operator');
      attempt += 1;
      if (attempt > task.maxAttempts * graph.nodes.length) {
        throw new Error(`Exceeded max attempts budget (${task.maxAttempts})`);
      }
      this.assertBudget(task);

      const nodeRunId = randomUUID();
      this.db
        .prepare(
          'INSERT INTO node_runs (id, graph_run_id, node_key, state, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(nodeRunId, graphRunId, role, 'running', now(), now());

      const route =
        role === 'planner' || role === 'reviewer' || role === 'writer' || role === 'verifier'
          ? await this.resolveRoute(role)
          : undefined;

      const phase =
        role === 'test'
          ? 'running_tests'
          : role === 'writer'
            ? 'writing'
            : role === 'accept' || role === 'reviewer'
              ? 'awaiting_confirmation'
              : 'reasoning';
      this.updateExecution(task, graphRunId, nodeRunId, role, phase, route);
      this.appendEvent(task.id, `node.${role}.started`, {
        graphRunId,
        nodeRunId,
        role,
        providerId: route?.providerId,
        fallbackUsed: route?.fallbackUsed,
      });

      const invocationId = randomUUID();
      this.invocations.create({
        id: invocationId,
        nodeRunId,
        providerConnectionId: route?.providerId ?? 'deterministic',
        configuredModelId: route?.modelId ?? 'command-runner',
        status: 'running',
        startedAt: now(),
      });

      const disclosureEntries = [
        {
          id: `task:${task.id}`,
          content: [
            `Title: ${task.title}`,
            task.brief,
            `Expected: ${task.expectedBehaviour ?? 'n/a'}`,
            `Actual: ${task.actualBehaviour ?? 'n/a'}`,
          ].join('\n'),
          source: 'task.brief',
          sensitivity: 'internal' as const,
          priority: 100,
        },
        buildRepositoryMap(
          (() => {
            try {
              return readdirSync(worktreePath);
            } catch {
              return [];
            }
          })(),
        ),
        ...(this.documents?.list(task.id) ?? [])
          .filter((doc) => doc.extractedText)
          .slice(0, 5)
          .map((doc) => ({
            id: `document:${doc.id}`,
            content: doc.extractedText!.slice(0, 2_000),
            source: `document:${doc.fileName}`,
            path: doc.fileName,
            sensitivity: 'internal' as const,
            priority: doc.authority === 'authoritative_requirement' ? 90 : 50,
          })),
        ...new LocalKnowledgeRepository(this.db)
          .list({ projectId: task.projectId, state: 'published' })
          .slice(0, 8)
          .map((item) => ({
            id: `knowledge:${item.id}`,
            content: `${item.title}\n${item.body}`,
            source: `knowledge:${item.type}`,
            sensitivity: 'internal' as const,
            priority: 30,
          })),
      ];
      const compiled = compileContext({
        role: (['planner', 'reviewer', 'writer', 'test', 'verifier', 'accept'].includes(role)
          ? role
          : 'planner') as RoleId,
        items: disclosureEntries,
      });
      this.evidence.addDisclosureManifest({
        id: randomUUID(),
        invocationId,
        providerConnectionId: route?.providerId ?? 'deterministic',
        selectedContext: {
          role: compiled.role,
          contract: compiled.contract,
          totalTokens: compiled.disclosure.totalTokens,
          totalBytes: compiled.disclosure.totalBytes,
          entries: compiled.disclosure.entries,
          omitted: compiled.omitted,
        },
        exclusions: compiled.disclosure.exclusions,
        createdAt: now(),
      });

      if (role === 'planner' || role === 'verifier') {
        const adapter =
          route?.adapter ??
          new FakeProvider('fake', [
            { type: 'phase.changed', phase: 'reasoning' },
            { type: 'heartbeat', at: now() },
            { type: 'invocation.completed', output: { summary: `Completed ${task.title}` } },
          ]);
        const output = await this.consumeInvocation({
          adapter,
          invocationId,
          nodeRunId,
          prompt: `${role.toUpperCase()} for RoleFlock task "${task.title}" (read-only).\nDo not modify files.\n\n${compiled.promptBlock}`,
          cwd: worktreePath,
          signal: controller.signal,
        });
        this.evidence.addFinding({
          id: randomUUID(),
          taskId: task.id,
          nodeRunId,
          severity: 'info',
          summary: `${role} via ${route?.providerDisplayName ?? 'fake'} / ${route?.modelDisplayName ?? 'phase0-fake'} · ${compiled.disclosure.totalTokens} ctx tokens`,
          details: output || task.brief,
          createdAt: now(),
        });
      } else if (role === 'reviewer') {
        if (route && route.providerId !== 'fake') {
          await this.consumeInvocation({
            adapter: route.adapter,
            invocationId,
            nodeRunId,
            prompt: `Review plan and confirm whether writing ROLEFLOCK_FIX.md is an appropriate scope.\n\n${compiled.promptBlock}`,
            cwd: worktreePath,
            signal: controller.signal,
          });
        }
        const confirmation = createConfirmationRequest({
          taskId: task.id,
          graphRunId,
          nodeRunId,
          requestType: 'expand_scope',
          rationale: 'Reviewer asks to confirm the proposed fix scope before writing.',
          exactAction: {
            kind: 'scope',
            verb: 'confirm',
            target: graph.id,
            paths: ['ROLEFLOCK_FIX.md'],
            sideEffectClass: 'local_write',
          },
          affectedPaths: ['ROLEFLOCK_FIX.md'],
          riskClass: 'medium',
          stateHash: baseCommit,
        });
        const autoApproved = this.tryGrantAutoApproval(confirmation, task.projectId);
        this.confirmations.create(autoApproved.request);
        if (autoApproved.skipped) {
          this.evidence.addFinding({
            id: randomUUID(),
            taskId: task.id,
            nodeRunId,
            severity: 'info',
            summary: 'Reviewer confirmation auto-approved via grant',
            details: confirmation.rationale,
            createdAt: now(),
          });
        } else {
          this.setTaskState(task.id, 'awaiting_confirmation');
          this.updateExecution(task, graphRunId, nodeRunId, role, 'awaiting_confirmation', route);
          this.bus.publish('approval.requested', autoApproved.request);
          const decision = await this.waitForConfirmation(confirmation.id, controller.signal);
          if (decision === 'rejected') throw new Error('Confirmation rejected');
        }
      } else if (role === 'writer') {
        await this.assertDocumentConflictsResolved(task, graphRunId, nodeRunId, baseCommit, controller);
        const leaseId = randomUUID();
        const memLease = new WriterLease(worktreePath, nodeRunId);
        if (!memLease.acquire()) throw new Error('Writer lease unavailable');
        try {
          this.leases.tryAcquire({
            id: leaseId,
            resourceType: 'writer',
            resourceId: worktreePath,
            ownerId: nodeRunId,
            acquiredAt: now(),
          });
        } catch {
          memLease.release();
          throw new Error('Writer lease unavailable (durable)');
        }
        this.worktrees.setWriterLease(task.id, nodeRunId);
        try {
          const relativeTarget = 'ROLEFLOCK_FIX.md';
          const content = `# RoleFlock verified fix\n\n${task.brief}\n\nExpected: ${task.expectedBehaviour ?? 'n/a'}\nActual: ${task.actualBehaviour ?? 'n/a'}\nProvider: ${route?.providerDisplayName ?? 'fake'}\nVerification: ${task.verificationCommand ?? 'artefact-present / npm test / ROLEFLOCK_FORCE_FAKE'}\n`;
          const envelope = {
            worktree: worktreePath,
            allowedPaths: [relativeTarget],
            allowCommands: false,
          };
          if (route?.adapter instanceof CursorWriterAdapter) {
            await route.adapter.write(relativeTarget, content, envelope);
          } else {
            await writeFile(join(worktreePath, relativeTarget), content);
          }
          const diff = await captureDiff(worktreePath);
          this.evidence.addArtefact({
            id: randomUUID(),
            taskId: task.id,
            kind: 'diff',
            path: join(worktreePath, relativeTarget),
            contentRef: diff.patch,
            metadata: {
              changedFiles: diff.changedFiles,
              status: diff.status,
              providerId: route?.providerId,
              permissionEnvelope: envelope,
              durableLeaseId: leaseId,
            },
            createdAt: now(),
          });
        } finally {
          this.leases.release(leaseId, now());
          memLease.release();
          this.worktrees.setWriterLease(task.id, null);
        }
      } else if (role === 'test') {
        const verification = await this.resolveVerification(task, worktreePath);
        let passed = false;
        let exitCode: number | undefined;
        let stdout = '';
        let stderr = '';
        try {
          const result = await runCommand({
            command: verification.command,
            args: verification.args,
            cwd: worktreePath,
            sandboxRoot: worktreePath,
            timeoutMs: 60_000,
          });
          passed = true;
          exitCode = result.exitCode ?? 0;
          stdout = result.stdout;
          stderr = result.stderr;
        } catch (error) {
          if (error instanceof CommandError) {
            exitCode = error.result.exitCode ?? undefined;
            stdout = error.result.stdout;
            stderr = error.result.stderr;
            passed = false;
          } else {
            throw error;
          }
        }
        this.evidence.addTestRun({
          id: randomUUID(),
          taskId: task.id,
          nodeRunId,
          command: verification.label,
          exitCode,
          stdoutRef: stdout,
          stderrRef: stderr,
          passed,
          createdAt: now(),
        });
        if (!passed) {
          throw new Error(
            `Verification failed (${verification.label})${stderr ? `: ${stderr.slice(0, 400)}` : ''}`,
          );
        }
      } else if (role === 'accept') {
        this.setTaskState(task.id, 'awaiting_acceptance');
        this.updateExecution(task, graphRunId, nodeRunId, role, 'awaiting_confirmation');
        const decision = await this.waitForAcceptance(task.id, controller.signal);
        if (decision === 'rejected') throw new Error('Human rejected the change');
      }

      const costsBefore = this.usage.summarize(task.id);
      this.invocations.updateStatus(invocationId, 'completed', 'success', now());
      const providerConnectionId = route?.providerId ?? 'deterministic';
      const modelId = route?.modelId ?? 'command-runner';
      const tokens = {
        inputTokens: providerConnectionId === 'fake' || !route ? 100 : 250,
        outputTokens: providerConnectionId === 'fake' || !route ? 50 : 120,
      };
      const priced = estimateInvocationCost({
        tokens,
        providerConnectionId,
        modelId,
        cards: loadPriceCards(this.db),
      });
      this.usage.append({
        id: randomUUID(),
        taskId: task.id,
        invocationId,
        providerConnectionId,
        modelId,
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
        actualCostUsd: priced.actualCostUsd,
        shadowCostUsd: priced.shadowCostUsd,
        confidence: priced.confidence,
        createdAt: now(),
      });
      const costs = this.usage.summarize(task.id);
      const budget = budgetStatus({
        actualCostUsd: costs.actualCostUsd,
        maxActualCostUsd: task.maxActualCostUsd,
      });
      if (budget.warning && costsBefore.actualCostUsd < costs.actualCostUsd) {
        this.evidence.addFinding({
          id: randomUUID(),
          taskId: task.id,
          nodeRunId,
          severity: 'warning',
          summary: 'Approaching hard budget',
          details: `Actual $${costs.actualCostUsd.toFixed(4)} of max $${task.maxActualCostUsd?.toFixed(4)} (shadow $${costs.shadowCostUsd.toFixed(4)} tracked separately).`,
          createdAt: now(),
        });
      }
      const execution = this.executions.getByNodeRun(nodeRunId);
      if (execution) {
        execution.actualCost = costs.actualCostUsd;
        execution.shadowCost = costs.shadowCostUsd;
        execution.usageConfidence = priced.confidence;
        this.executions.upsert(execution);
      }
      this.db
        .prepare('UPDATE node_runs SET state = ?, completed_at = ?, outcome = ? WHERE id = ?')
        .run('completed', now(), 'success', nodeRunId);
      this.bus.publish('execution.updated', this.executions.getByTask(task.id));
      return { role, nodeRunId };
    });

    const failed = results.find((r) => r.status === 'failed');
    this.db
      .prepare('UPDATE graph_runs SET state = ?, completed_at = ? WHERE id = ?')
      .run(failed ? 'failed' : 'completed', now(), graphRunId);
    if (failed) {
      const message =
        failed.error instanceof Error
          ? failed.error.message
          : typeof failed.error === 'string'
            ? failed.error
            : `Node ${failed.nodeId} failed`;
      this.recordFailure(task.id, `Node ${failed.nodeId} failed`, message);
      if (!controller.signal.aborted) this.setTaskState(task.id, 'failed');
      throw new Error(message);
    }

    const taskNow = this.tasks.get(task.id);
    if (taskNow && taskNow.state !== 'accepted' && taskNow.state !== 'rejected') {
      this.setTaskState(task.id, 'accepted');
    }
  }

  private tryGrantAutoApproval(
    request: ConfirmationRequest,
    projectId: string,
  ): { request: ConfirmationRequest; skipped: boolean; grantId?: string } {
    const grants = new ApprovalGrantRepository(this.db).listActive(projectId);
    const grant = matchingGrant(request, grants);
    if (!grant) return { request, skipped: false };
    new ApprovalGrantRepository(this.db).incrementApplications(grant.id);
    new AuditRepository(this.db).append({
      id: randomUUID(),
      actor: 'local-user',
      action: 'approval.grant.applied',
      targetType: 'confirmation',
      targetId: request.id,
      details: { grantId: grant.id, fingerprint: request.fingerprint },
      createdAt: now(),
    });
    return {
      request: { ...request, status: 'approved' },
      skipped: true,
      grantId: grant.id,
    };
  }

  private recordFailure(taskId: string, summary: string, details: string): void {
    this.evidence.addFinding({
      id: randomUUID(),
      taskId,
      severity: 'error',
      summary,
      details,
      createdAt: now(),
    });
    this.bus.publish('task.failed', { taskId, error: details });
  }

  private async assertDocumentConflictsResolved(
    task: Task,
    graphRunId: string,
    nodeRunId: string,
    baseCommit: string,
    controller: AbortController,
  ): Promise<void> {
    if (!this.documents || this.documentConflictResolved.has(task.id)) return;
    const conflict = authoritativeConflictMessage(this.documents.list(task.id));
    if (!conflict) return;

    const confirmation = createConfirmationRequest({
      taskId: task.id,
      graphRunId,
      nodeRunId,
      requestType: 'clarify_requirement',
      rationale: conflict,
      exactAction: {
        kind: 'scope',
        verb: 'confirm',
        target: 'supporting-documents',
        paths: this.documents.list(task.id).map((doc) => doc.fileName),
        sideEffectClass: 'none',
      },
      affectedPaths: this.documents.list(task.id).map((doc) => doc.fileName),
      riskClass: 'high',
      stateHash: baseCommit,
    });
    const autoApproved = this.tryGrantAutoApproval(confirmation, task.projectId);
    this.confirmations.create(autoApproved.request);
    if (autoApproved.skipped) {
      this.evidence.addFinding({
        id: randomUUID(),
        taskId: task.id,
        nodeRunId,
        severity: 'info',
        summary: 'Document conflict confirmation auto-approved via grant',
        details: conflict,
        createdAt: now(),
      });
      this.documentConflictResolved.add(task.id);
      return;
    }
    this.setTaskState(task.id, 'awaiting_confirmation');
    this.updateExecution(task, graphRunId, nodeRunId, 'writer', 'awaiting_confirmation');
    this.bus.publish('approval.requested', autoApproved.request);
    const decision = await this.waitForConfirmation(confirmation.id, controller.signal);
    if (decision === 'rejected') {
      throw new Error('Authoritative document conflict was rejected');
    }
    this.documentConflictResolved.add(task.id);
    this.setTaskState(task.id, 'running');
  }

  private async resolveRoute(role: RoutedRole): Promise<RoleRoute> {
    if (!this.providers) {
      const fake = new FakeProvider();
      return {
        role,
        providerId: 'fake',
        providerDisplayName: 'Phase 0 Fake Provider',
        modelId: 'phase0-fake',
        modelDisplayName: 'Phase 0 Fake',
        adapter: fake,
        fallbackUsed: true,
      };
    }
    return routeRole(this.providers, role, { forceFake: this.forceFake });
  }

  private providerTimeoutMs(): number {
    const raw = Number(process.env.ROLEFLOCK_PROVIDER_TIMEOUT_MS ?? 90_000);
    return Number.isFinite(raw) && raw > 0 ? raw : 90_000;
  }

  private invocationSignal(parent: AbortSignal): AbortSignal {
    const timeout = AbortSignal.timeout(this.providerTimeoutMs());
    return AbortSignal.any([parent, timeout]);
  }

  private async consumeInvocation(input: {
    adapter: ProviderAdapter;
    invocationId: string;
    nodeRunId: string;
    prompt: string;
    cwd: string;
    signal: AbortSignal;
    permissionEnvelope?: {
      worktree: string;
      allowedPaths: string[];
      allowCommands?: boolean;
    };
  }): Promise<string> {
    let output = '';
    try {
      for await (const event of input.adapter.invoke({
        invocationId: input.invocationId,
        prompt: input.prompt,
        cwd: input.cwd,
        signal: this.invocationSignal(input.signal),
        permissionEnvelope: input.permissionEnvelope,
      })) {
        if (event.type === 'heartbeat') {
          const execution = this.executions.getByNodeRun(input.nodeRunId);
          if (execution) {
            execution.lastHeartbeatAt = event.at;
            this.executions.upsert(execution);
            this.bus.publish('execution.updated', execution);
          }
        }
        if (event.type === 'model.output.delta') output += event.text;
        if (event.type === 'invocation.failed') {
          throw new Error(event.error.message);
        }
        if (event.type === 'invocation.interrupted') {
          throw new Error(event.reason);
        }
      }
    } catch (error) {
      if (input.signal.aborted) throw new Error('Cancelled by operator');
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `Provider invocation timed out after ${this.providerTimeoutMs()}ms (set ROLEFLOCK_PROVIDER_TIMEOUT_MS to adjust)`,
        );
      }
      throw error;
    }
    return output;
  }

  private forceKillTaskProcesses(taskId: string, nodeRunId: string): void {
    for (const handle of this.processHandles.listRunning()) {
      if (handle.nodeRunId !== nodeRunId) continue;
      try {
        if (handle.pgid && process.platform !== 'win32') {
          process.kill(-handle.pgid, 'SIGKILL');
        } else {
          process.kill(handle.pid, 'SIGKILL');
        }
      } catch {
        // process may already be gone
      }
      this.processHandles.setStatus(handle.id, 'terminated', now());
    }
    this.bus.publish('control.force_killed', { taskId, nodeRunId });
  }

  private async resolveVerification(
    task: Task,
    worktreePath: string,
  ): Promise<VerificationSpec> {
    if (this.forceFake) {
      return {
        command: process.execPath,
        args: ['-e', 'console.log("RoleFlock deterministic test passed")'],
        label: 'deterministic-fake',
      };
    }
    if (task.verificationCommand?.trim()) {
      const parts = task.verificationCommand.trim().split(/\s+/).filter(Boolean);
      const command = parts[0]!;
      return {
        command,
        args: parts.slice(1),
        label: task.verificationCommand.trim(),
      };
    }
    try {
      const pkg = JSON.parse(await readFile(join(worktreePath, 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>;
      };
      if (pkg.scripts?.test) {
        return { command: 'npm', args: ['test', '--silent'], label: 'npm test' };
      }
    } catch {
      // no package.json / no test script
    }
    return {
      command: process.execPath,
      args: [
        '-e',
        "require('fs').accessSync('ROLEFLOCK_FIX.md'); console.log('verified artefact present')",
      ],
      label: 'artefact-present',
    };
  }

  private assertBudget(task: Task): void {
    const summary = this.usage.summarize(task.id);
    const status = budgetStatus({
      actualCostUsd: summary.actualCostUsd,
      maxActualCostUsd: task.maxActualCostUsd,
    });
    if (status.hardStop) {
      throw new Error(
        `Hard budget reached: actual $${summary.actualCostUsd.toFixed(4)} >= max $${task.maxActualCostUsd!.toFixed(4)} (shadow $${summary.shadowCostUsd.toFixed(4)} is tracked separately and is not a bill)`,
      );
    }
  }

  private waitForAcceptance(
    taskId: string,
    signal: AbortSignal,
  ): Promise<'accepted' | 'rejected'> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('Cancelled'));
        return;
      }
      const onAbort = () => {
        this.acceptanceWaiters.delete(taskId);
        reject(new Error('Cancelled'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.acceptanceWaiters.set(taskId, {
        resolve: (decision) => {
          signal.removeEventListener('abort', onAbort);
          resolve(decision);
        },
      });
    });
  }

  private waitForConfirmation(
    id: string,
    signal: AbortSignal,
  ): Promise<'approved' | 'rejected'> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Error('Cancelled'));
        return;
      }
      const onAbort = () => {
        this.confirmationWaiters.delete(id);
        reject(new Error('Cancelled'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.confirmationWaiters.set(id, {
        resolve: (decision) => {
          signal.removeEventListener('abort', onAbort);
          resolve(decision);
        },
      });
    });
  }

  private updateExecution(
    task: Task,
    graphRunId: string,
    nodeRunId: string,
    role: string,
    phase: ActiveExecution['phase'],
    route?: RoleRoute,
  ): void {
    const timestamp = now();
    const costs = this.usage.summarize(task.id);
    const roleModels: Record<string, { provider: string; model: string }> = {
      planner: { provider: 'Claude (fake)', model: 'phase0-fake-planner' },
      reviewer: { provider: 'Custom (fake)', model: 'phase0-fake-reviewer' },
      writer: { provider: 'Cursor (fake)', model: 'phase0-fake-writer' },
      test: { provider: 'Deterministic', model: 'command-runner' },
      verifier: { provider: 'Codex (fake)', model: 'phase0-fake-verifier' },
      accept: { provider: 'Human', model: 'operator' },
    };
    const mapping = roleModels[role] ?? { provider: 'Phase 0 Fake', model: 'phase0-fake' };
    this.executions.upsert({
      graphRunId,
      nodeRunId,
      taskId: task.id,
      roleId: role,
      roleDisplayName: role,
      providerConnectionId: route?.providerId ?? (role === 'test' ? 'deterministic' : 'fake'),
      providerDisplayName: route?.providerDisplayName ?? mapping.provider,
      configuredModelId: route?.modelId ?? mapping.model,
      configuredModelDisplayName: route?.modelDisplayName ?? mapping.model,
      effort: 'standard',
      phase,
      permissionProfileId: role === 'writer' ? 'worktree-write' : 'read-only',
      currentActivity: route?.fallbackUsed
        ? `${role} executing (fallback)`
        : `${role} executing`,
      activeCommandPreview: role === 'test' ? 'verification command' : undefined,
      startedAt: timestamp,
      lastHeartbeatAt: timestamp,
      attempt: 1,
      maxAttempts: task.maxAttempts,
      actualCost: costs.actualCostUsd,
      shadowCost: costs.shadowCostUsd,
      usageConfidence: route && route.providerId !== 'fake' ? 'estimated' : 'exact',
      pauseRequested: false,
      stopRequested: false,
      forceTerminationAvailable: true,
    });
    this.bus.publish('execution.updated', this.executions.getByTask(task.id));
  }

  private appendEvent(taskId: string, eventType: string, payload: Record<string, unknown>): void {
    this.events.append({
      id: randomUUID(),
      aggregateType: 'task',
      aggregateId: taskId,
      sequence: this.events.getLastSequence(taskId) + 1,
      eventType,
      payload,
      metadata: { schemaVersion: 1 },
      createdAt: now(),
    });
  }

  private setTaskState(taskId: string, state: Task['state']): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    this.tasks.upsert({ ...task, state, updatedAt: now() });
    this.bus.publish('task.updated', { taskId, state });
  }
}

const now = () => new Date().toISOString();
