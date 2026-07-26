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
import { bugFixGraph } from '@roleflock/graph-core';
import { runSequentialGraph } from '@roleflock/graph-runtime';
import {
  captureDiff,
  createWorktree,
  registerRepository,
  WriterLease,
} from '@roleflock/repository-runtime';
import { FakeProvider } from '@roleflock/provider-core';
import { EventBus } from './event-bus.js';

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

  constructor(
    private readonly db: SqliteDb,
    private readonly bus: EventBus,
    worktreeBaseDir: string,
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
    mkdirSync(worktreeBaseDir, { recursive: true });
  }

  start(task: Task, repositoryPath: string, baseBranch: string): void {
    if (task.type !== 'bug_fix') throw new Error('Phase 0 supports bug_fix tasks only');
    if (this.active.has(task.id)) throw new Error('Task is already running');
    const controller = new AbortController();
    this.active.set(task.id, controller);
    void this.run(task, repositoryPath, baseBranch, controller).finally(() =>
      this.active.delete(task.id),
    );
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

  private async run(
    task: Task,
    repositoryPath: string,
    baseBranch: string,
    controller: AbortController,
  ): Promise<void> {
    const graphRunId = randomUUID();
    const repo = await registerRepository(repositoryPath);
    const worktree = await createWorktree(repo, task.id, {
      baseRef: baseBranch === 'HEAD' ? 'HEAD' : baseBranch,
      worktreeBaseDir: this.worktreeBaseDir,
    });
    this.db
      .prepare(
        'INSERT INTO graph_runs (id, task_id, graph_version_id, state, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(graphRunId, task.id, 'bug-fix-v1', 'running', now(), now());
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

    const provider = new FakeProvider('fake', [
      { type: 'phase.changed', phase: 'reasoning' },
      { type: 'heartbeat', at: now() },
      {
        type: 'invocation.completed',
        output: { summary: `Completed ${task.title}` },
      },
    ]);

    const results = await runSequentialGraph(bugFixGraph, async (role) => {
      if (controller.signal.aborted) throw new Error('Cancelled by operator');
      const nodeRunId = randomUUID();
      this.db
        .prepare(
          'INSERT INTO node_runs (id, graph_run_id, node_key, state, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(nodeRunId, graphRunId, role, 'running', now(), now());

      const phase =
        role === 'test'
          ? 'running_tests'
          : role === 'writer'
            ? 'writing'
            : role === 'accept'
              ? 'awaiting_confirmation'
              : 'reasoning';
      this.updateExecution(task, graphRunId, nodeRunId, role, phase);
      this.appendEvent(task.id, `node.${role}.started`, { graphRunId, nodeRunId, role });

      const invocationId = randomUUID();
      this.invocations.create({
        id: invocationId,
        nodeRunId,
        providerConnectionId: 'fake',
        configuredModelId: 'phase0-fake',
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
          id: `worktree:${worktree.path}`,
          content: worktree.path,
          source: 'worktree.path',
          sensitivity: 'internal',
        },
      ]);
      const disclosureId = randomUUID();
      this.evidence.addDisclosureManifest({
        id: disclosureId,
        invocationId,
        providerConnectionId: 'fake',
        selectedContext: disclosure.entries,
        exclusions: ['.env', '**/*.pem', '**/*.key'],
        createdAt: now(),
      });

      if (role === 'planner' || role === 'verifier') {
        for await (const event of provider.invoke({
          invocationId,
          prompt: `${role}: ${task.brief}`,
          cwd: worktree.path,
          signal: controller.signal,
        })) {
          if (event.type === 'heartbeat') {
            const execution = this.executions.getByNodeRun(nodeRunId);
            if (execution) {
              execution.lastHeartbeatAt = event.at;
              this.executions.upsert(execution);
            }
          }
        }
        this.evidence.addFinding({
          id: randomUUID(),
          taskId: task.id,
          nodeRunId,
          severity: 'info',
          summary: `${role} completed with configured model phase0-fake`,
          details: task.brief,
          createdAt: now(),
        });
      } else if (role === 'reviewer') {
        const confirmation = createConfirmationRequest({
          taskId: task.id,
          graphRunId,
          nodeRunId,
          requestType: 'expand_scope',
          rationale: 'Reviewer asks to confirm the proposed fix scope before writing.',
          exactAction: {
            kind: 'scope',
            verb: 'confirm',
            target: 'bug_fix',
            paths: ['ROLEFLOCK_FIX.md'],
            sideEffectClass: 'local_write',
          },
          affectedPaths: ['ROLEFLOCK_FIX.md'],
          riskClass: 'medium',
          stateHash: worktree.baseCommit,
        });
        this.confirmations.create(confirmation);
        this.setTaskState(task.id, 'awaiting_confirmation');
        this.bus.publish('approval.requested', confirmation);
        const decision = await this.waitForConfirmation(confirmation.id, controller.signal);
        if (decision === 'rejected') throw new Error('Confirmation rejected');
      } else if (role === 'writer') {
        const lease = new WriterLease(worktree.path, nodeRunId);
        if (!lease.acquire()) throw new Error('Writer lease unavailable');
        this.worktrees.setWriterLease(task.id, nodeRunId);
        try {
          const target = join(worktree.path, 'ROLEFLOCK_FIX.md');
          await writeFile(
            target,
            `# RoleFlock verified fix\n\n${task.brief}\n\nExpected: ${task.expectedBehaviour ?? 'n/a'}\nActual: ${task.actualBehaviour ?? 'n/a'}\n`,
          );
          const diff = await captureDiff(worktree.path);
          this.evidence.addArtefact({
            id: randomUUID(),
            taskId: task.id,
            kind: 'diff',
            path: target,
            contentRef: diff.patch,
            metadata: { changedFiles: diff.changedFiles, status: diff.status },
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
          cwd: worktree.path,
          sandboxRoot: worktree.path,
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

      this.invocations.updateStatus(invocationId, 'completed', 'success', now());
      this.usage.append({
        id: randomUUID(),
        taskId: task.id,
        invocationId,
        providerConnectionId: 'fake',
        modelId: 'phase0-fake',
        inputTokens: 100,
        outputTokens: 50,
        actualCostUsd: 0,
        shadowCostUsd: 0.01,
        confidence: 'exact',
        createdAt: now(),
      });
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
    if (!failed) {
      const taskNow = this.tasks.get(task.id);
      if (taskNow && taskNow.state !== 'accepted' && taskNow.state !== 'rejected') {
        this.setTaskState(task.id, 'accepted');
      }
    } else if (!controller.signal.aborted) {
      this.setTaskState(task.id, 'failed');
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
  ): void {
    const timestamp = now();
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
      providerConnectionId: 'fake',
      providerDisplayName: mapping.provider,
      configuredModelId: mapping.model,
      configuredModelDisplayName: mapping.model,
      effort: 'standard',
      phase,
      permissionProfileId: role === 'writer' ? 'worktree-write' : 'read-only',
      currentActivity: `${role} executing`,
      activeCommandPreview: role === 'test' ? 'node -e deterministic-test' : undefined,
      startedAt: timestamp,
      lastHeartbeatAt: timestamp,
      attempt: 1,
      maxAttempts: task.maxAttempts,
      actualCost: 0,
      shadowCost: 0.01,
      usageConfidence: 'exact',
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
