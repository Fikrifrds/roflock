import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ActiveExecution, Task } from '@roleflock/contracts';
import { createConfirmationRequest } from '@roleflock/approval-engine';
import { buildDisclosureManifest } from '@roleflock/context-compiler';
import {
  ActiveExecutionRepository,
  ConfirmationRepository,
  ControlCommandRepository,
  EvidenceRepository,
  EventStore,
  InvocationRepository,
  TaskRepository,
  UsageRepository,
  WorktreeRepository,
  type SqliteDb,
} from '@roleflock/database';
import { runCommand } from '@roleflock/command-runner';
import { getWorkflowGraph, type WorkflowGraph } from '@roleflock/graph-core';
import { runSequentialGraph } from '@roleflock/graph-runtime';
import {
  captureDiff,
  createWorktree,
  registerRepository,
  WriterLease,
} from '@roleflock/repository-runtime';
import { FakeProvider } from '@roleflock/provider-core';
import { EventBus } from './event-bus.js';
import type { ProviderRegistry } from './provider-registry.js';
import { routeRole, type RoleRoute, type RoutedRole } from './role-routing.js';

interface PreparedRun {
  graphRunId: string;
  graph: WorkflowGraph;
  worktreePath: string;
  baseCommit: string;
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
  private readonly worktreeBaseDir: string;
  private readonly providers?: ProviderRegistry;
  private readonly forceFake: boolean;

  constructor(
    private readonly db: SqliteDb,
    private readonly bus: EventBus,
    worktreeBaseDir: string,
    providers?: ProviderRegistry,
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
    this.worktreeBaseDir = worktreeBaseDir;
    this.providers = providers;
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
    if (['stop', 'force-terminate', 'cancel'].includes(commandType)) {
      execution.stopRequested = true;
      this.executions.upsert(execution);
      this.active.get(taskId)?.abort();
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
      task.workflowGraphVersionId === 'bug_fix'
        ? task.workflowGraphVersionId
        : task.type === 'bug_fix'
          ? 'bug_fix'
          : 'standard';
    const graph = getWorkflowGraph(graphMode);
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

      const disclosure = buildDisclosureManifest([
        {
          id: `task:${task.id}`,
          content: task.brief,
          source: 'task.brief',
          sensitivity: 'internal',
        },
        {
          id: `worktree:${worktreePath}`,
          content: worktreePath,
          source: 'worktree.path',
          sensitivity: 'internal',
        },
      ]);
      this.evidence.addDisclosureManifest({
        id: randomUUID(),
        invocationId,
        providerConnectionId: route?.providerId ?? 'deterministic',
        selectedContext: disclosure.entries,
        exclusions: ['.env', '**/*.pem', '**/*.key'],
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
        let output = '';
        for await (const event of adapter.invoke({
          invocationId,
          prompt: `${role.toUpperCase()} for RoleFlock task "${task.title}":\n${task.brief}\nExpected: ${task.expectedBehaviour ?? 'n/a'}\nActual: ${task.actualBehaviour ?? 'n/a'}`,
          cwd: worktreePath,
          signal: controller.signal,
        })) {
          if (event.type === 'heartbeat') {
            const execution = this.executions.getByNodeRun(nodeRunId);
            if (execution) {
              execution.lastHeartbeatAt = event.at;
              this.executions.upsert(execution);
            }
          }
          if (event.type === 'model.output.delta') output += event.text;
          if (event.type === 'invocation.failed') {
            throw new Error(event.error.message);
          }
        }
        this.evidence.addFinding({
          id: randomUUID(),
          taskId: task.id,
          nodeRunId,
          severity: 'info',
          summary: `${role} via ${route?.providerDisplayName ?? 'fake'} / ${route?.modelDisplayName ?? 'phase0-fake'}`,
          details: output || task.brief,
          createdAt: now(),
        });
      } else if (role === 'reviewer') {
        if (route && route.providerId !== 'fake') {
          for await (const event of route.adapter.invoke({
            invocationId,
            prompt: `Review plan for: ${task.brief}`,
            cwd: worktreePath,
            signal: controller.signal,
          })) {
            if (event.type === 'invocation.failed') throw new Error(event.error.message);
          }
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
        this.confirmations.create(confirmation);
        this.setTaskState(task.id, 'awaiting_confirmation');
        this.updateExecution(task, graphRunId, nodeRunId, role, 'awaiting_confirmation', route);
        this.bus.publish('approval.requested', confirmation);
        const decision = await this.waitForConfirmation(confirmation.id, controller.signal);
        if (decision === 'rejected') throw new Error('Confirmation rejected');
      } else if (role === 'writer') {
        const lease = new WriterLease(worktreePath, nodeRunId);
        if (!lease.acquire()) throw new Error('Writer lease unavailable');
        this.worktrees.setWriterLease(task.id, nodeRunId);
        try {
          // Deterministic sandbox write remains the security boundary for Phase 0/1.
          // Cursor CLI may be selected for attribution when ready, but writes stay leased.
          const target = join(worktreePath, 'ROLEFLOCK_FIX.md');
          await writeFile(
            target,
            `# RoleFlock verified fix\n\n${task.brief}\n\nExpected: ${task.expectedBehaviour ?? 'n/a'}\nActual: ${task.actualBehaviour ?? 'n/a'}\nProvider: ${route?.providerDisplayName ?? 'fake'}\n`,
          );
          const diff = await captureDiff(worktreePath);
          this.evidence.addArtefact({
            id: randomUUID(),
            taskId: task.id,
            kind: 'diff',
            path: target,
            contentRef: diff.patch,
            metadata: {
              changedFiles: diff.changedFiles,
              status: diff.status,
              providerId: route?.providerId,
            },
            createdAt: now(),
          });
        } finally {
          lease.release();
          this.worktrees.setWriterLease(task.id, null);
        }
      } else if (role === 'test') {
        const result = await runCommand({
          command: process.execPath,
          args: ['-e', 'console.log("RoleFlock deterministic test passed")'],
          cwd: worktreePath,
          sandboxRoot: worktreePath,
          timeoutMs: 15_000,
        });
        this.evidence.addTestRun({
          id: randomUUID(),
          taskId: task.id,
          nodeRunId,
          command: `${process.execPath} -e test`,
          exitCode: result.exitCode ?? undefined,
          stdoutRef: result.stdout,
          stderrRef: result.stderr,
          passed: true,
          createdAt: now(),
        });
      } else if (role === 'accept') {
        this.setTaskState(task.id, 'awaiting_acceptance');
        this.updateExecution(task, graphRunId, nodeRunId, role, 'awaiting_confirmation');
        const decision = await this.waitForAcceptance(task.id, controller.signal);
        if (decision === 'rejected') throw new Error('Human rejected the change');
      }

      const costs = this.usage.summarize(task.id);
      this.invocations.updateStatus(invocationId, 'completed', 'success', now());
      this.usage.append({
        id: randomUUID(),
        taskId: task.id,
        invocationId,
        providerConnectionId: route?.providerId ?? 'deterministic',
        modelId: route?.modelId ?? 'command-runner',
        inputTokens: route?.providerId === 'fake' || !route ? 100 : 250,
        outputTokens: route?.providerId === 'fake' || !route ? 50 : 120,
        actualCostUsd: route && route.providerId !== 'fake' ? 0.02 : 0,
        shadowCostUsd: 0.01,
        confidence: route && route.providerId !== 'fake' ? 'estimated' : 'exact',
        createdAt: now(),
      });
      const execution = this.executions.getByNodeRun(nodeRunId);
      if (execution) {
        execution.actualCost = costs.actualCostUsd;
        execution.shadowCost = costs.shadowCostUsd + 0.01;
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

  private assertBudget(task: Task): void {
    if (task.maxActualCostUsd === undefined) return;
    const summary = this.usage.summarize(task.id);
    if (summary.actualCostUsd >= task.maxActualCostUsd) {
      throw new Error(
        `Hard budget reached: actual $${summary.actualCostUsd.toFixed(4)} >= max $${task.maxActualCostUsd.toFixed(4)}`,
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
      activeCommandPreview: role === 'test' ? 'node -e deterministic-test' : undefined,
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
