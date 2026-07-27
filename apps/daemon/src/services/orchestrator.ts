import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ActiveExecution,
  ConfirmationRequest,
  Task,
  UsageConfidence,
} from '@roleflock/contracts';
import { createConfirmationRequest, matchingGrant } from '@roleflock/approval-engine';
import { buildRepositoryMap, compileContext, type RoleId } from '@roleflock/context-compiler';
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
import {
  getWorkflowGraph,
  graphVersionId,
  validateGraph,
  type GraphMode,
  type WorkflowGraph,
} from '@roleflock/graph-core';
import { NodeFailure, runGraph } from '@roleflock/graph-runtime';
import {
  captureDiff,
  createWorktree,
  registerRepository,
  WriterLease,
} from '@roleflock/repository-runtime';
import {
  classifyProviderFailure,
  type Effort,
  type ReportedUsage,
  type ProviderAdapter,
} from '@roleflock/provider-core';
import { CursorWriterAdapter, assertChangedPathsAllowed } from '@roleflock/provider-cursor';
import { budgetStatus, estimateInvocationCost } from '@roleflock/usage-ledger';
import { EventBus } from './event-bus.js';
import { authoritativeConflictMessage, type DocumentService } from './documents.js';
import { loadPriceCards } from './pricing.js';
import { ProviderRegistry } from './provider-registry.js';
import { RoleRouter, type RoleRoute, type RoutedRole } from './role-routing.js';

interface PreparedRun {
  graphRunId: string;
  graph: WorkflowGraph;
  worktreePath: string;
  baseCommit: string;
  /** Nodes carried over from a run the daemon restarted out of. */
  resumeCompleted?: string[];
}

interface VerificationSpec {
  command: string;
  args: string[];
  label: string;
}

export interface ProviderRefusal {
  providerId: string;
  providerDisplayName: string;
  modelId: string;
  modelDisplayName: string;
  reason: string;
  detail: string;
  /** When the candidate becomes eligible again. Absent if it never ran. */
  until?: string;
}

/**
 * Every candidate configured for a role refused, and none of the refusals was
 * worth retrying.
 *
 * Distinct from an ordinary node failure because the remedy is different and so
 * is the state of the work: nothing the flock produced is wrong, the operator
 * simply has to point the role at a model that will answer. The run is left
 * resumable so doing that does not re-pay for the nodes that already succeeded.
 */
export class ProviderUnavailableError extends Error {
  constructor(
    readonly role: string,
    readonly refusals: ProviderRefusal[],
  ) {
    const summary = refusals.length
      ? refusals
          .map((r) => `${r.providerDisplayName}/${r.modelDisplayName} (${r.reason.replaceAll('_', ' ')})`)
          .join(', ')
      : 'no candidate was reachable';
    super(`No provider available for ${role}: ${summary}`);
    this.name = 'ProviderUnavailableError';
  }
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
  readonly router: RoleRouter;

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
    // A registry with only the fake provider still gives the router a real
    // preference list to walk, so routing behaves identically in tests.
    this.router = new RoleRouter(db, providers ?? new ProviderRegistry());
    mkdirSync(worktreeBaseDir, { recursive: true });
  }

  /** Awaits setup only; graph continues in background. */
  async start(
    task: Task,
    repositoryPath: string,
    baseBranch: string,
  ): Promise<{ graphRunId: string }> {
    // Resume: the graph is still alive and parked in `waitWhilePaused`, so the
    // only thing to do is lift the pause. Starting a second run here would put
    // two schedulers on one worktree.
    if (this.active.has(task.id)) {
      if (this.tasks.get(task.id)?.state !== 'paused') {
        throw new Error('Task is already running');
      }
      const execution = this.executions.getByTask(task.id);
      if (execution) {
        execution.pauseRequested = false;
        this.executions.upsert(execution);
      }
      this.setTaskState(task.id, 'running');
      this.appendEvent(task.id, 'task.resumed', {});
      const running = this.db
        .prepare(
          "SELECT id FROM graph_runs WHERE task_id = ? AND state = 'running' ORDER BY created_at DESC LIMIT 1",
        )
        .get(task.id) as { id: string } | undefined;
      return { graphRunId: running?.id ?? '' };
    }

    const controller = new AbortController();
    this.active.set(task.id, controller);

    try {
      const prepared = await this.prepareRun(task, repositoryPath, baseBranch);
      void this.executeGraph(task, prepared, controller)
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'Task execution failed';
          if (controller.signal.aborted) {
            // Stopped by the operator. Settle on a terminal state rather than
            // leaving the task reading `stopping` forever.
            this.appendEvent(task.id, 'task.stopped', { reason: message });
            const current = this.tasks.get(task.id)?.state;
            if (current !== 'cancelled') this.setTaskState(task.id, 'cancelled');
            return;
          }
          this.recordFailure(task.id, 'Task failed', message);
          this.setTaskState(task.id, 'failed');
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
      // `stopping` now, `cancelled` when the graph finishes unwinding. Leaving
      // it on `running` made a stopped task keep claiming it was working.
      this.setTaskState(taskId, 'stopping');
      this.active.get(taskId)?.abort();
    }
    if (commandType === 'force-terminate') {
      execution.stopRequested = true;
      this.executions.upsert(execution);
      this.setTaskState(taskId, 'stopping');
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
    // The task records the graph version it was created with. Resolving through
    // getWorkflowGraph keeps that version immutable for the life of the run: an
    // unknown or retired version fails loudly rather than silently upgrading.
    const graph = resolveTaskGraph(task);
    const graphErrors = validateGraph(graph);
    if (graphErrors.length) {
      throw new Error(`Invalid workflow graph: ${graphErrors.join(', ')}`);
    }
    // Resume: a run interrupted by a daemon restart keeps its finished nodes and
    // its worktree, so a restart re-enters the graph where it stopped instead of
    // rewriting work the user already paid for.
    const resume = this.resumableRun(task.id, graph);
    const existingWorktree = resume ? this.worktrees.getByTask(task.id) : undefined;
    const reusable =
      existingWorktree?.status === 'active' && existsSync(existingWorktree.path)
        ? existingWorktree
        : undefined;

    let worktree: { path: string; branchName: string; baseCommit: string };
    if (reusable) {
      worktree = {
        path: reusable.path,
        branchName: reusable.branchName,
        baseCommit: reusable.baseCommit,
      };
    } else {
      const repo = await registerRepository(repositoryPath);
      try {
        worktree = await createWorktree(repo, task.id, {
          baseRef: baseBranch === 'HEAD' ? 'HEAD' : baseBranch,
          worktreeBaseDir: this.worktreeBaseDir,
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to create Git worktree: ${detail}`, { cause: error });
      }
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
    }

    this.db
      .prepare(
        'INSERT INTO graph_runs (id, task_id, graph_version_id, state, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(graphRunId, task.id, graph.version, 'running', now(), now());
    this.setTaskState(task.id, 'running');
    const bootstrapNode = graph.nodes[0]?.id ?? 'planner';
    this.updateExecution(task, graphRunId, randomUUID(), bootstrapNode, 'preparing');
    this.bus.publish('task.started', { taskId: task.id, graphRunId });
    return {
      graphRunId,
      graph,
      worktreePath: worktree.path,
      baseCommit: worktree.baseCommit,
      resumeCompleted: reusable ? resume : undefined,
    };
  }

  /**
   * Records what a provider turn actually consumed.
   *
   * The numbers come from the CLI or they do not exist. RoleFlock previously
   * wrote a constant 250/120 tokens for every turn and priced that into a
   * displayed "actual cost", which made the ledger fiction — the one thing a
   * cost view must never be.
   *
   * When a provider states a price (Claude Code does) it is recorded as the
   * actual cost with `provider_reported` confidence. When it only reports
   * tokens, those tokens are real but the money is an estimate from a local
   * price card, so it lands in shadow cost and actual stays zero: a
   * subscription CLI bills a plan, not this call. When nothing is reported,
   * the entry says so rather than guessing.
   */
  private recordUsage(input: {
    task: Task;
    nodeRunId: string;
    invocationId: string;
    route: RoleRoute;
    usage?: ReportedUsage;
  }): void {
    const { task, route, usage } = input;
    const tokens = {
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    };
    const reportedNothing = usage?.inputTokens === undefined && usage?.outputTokens === undefined;

    const priced = estimateInvocationCost({
      tokens,
      providerConnectionId: route.providerId,
      modelId: route.modelId,
      cards: loadPriceCards(this.db),
    });

    // `estimated` in the middle case is the honest label: the tokens came from
    // the CLI, but the money is derived from a local price card, so the number
    // is an estimate even though its input was measured.
    const providerPriced = usage?.totalCostUsd !== undefined;
    const confidence: UsageConfidence = providerPriced
      ? 'provider_reported'
      : reportedNothing
        ? 'unknown'
        : 'estimated';

    this.usage.append({
      id: randomUUID(),
      taskId: task.id,
      invocationId: input.invocationId,
      providerConnectionId: route.providerId,
      modelId: route.modelId,
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      // A subscription CLI that reports tokens but no price has no per-call
      // bill to show; the money stays in shadow until a provider states one.
      actualCostUsd: providerPriced ? usage.totalCostUsd! : 0,
      shadowCostUsd: reportedNothing ? 0 : priced.shadowCostUsd,
      confidence,
      createdAt: now(),
    });

    const costs = this.usage.summarize(task.id);
    const execution = this.executions.getByNodeRun(input.nodeRunId);
    if (execution) {
      execution.actualCost = costs.actualCostUsd;
      execution.shadowCost = costs.shadowCostUsd;
      execution.usageConfidence = confidence;
      this.executions.upsert(execution);
    }
    this.applyBudgetWarning(task, input.nodeRunId);
  }

  /** Warns once when actual spend approaches the task's hard cap. */
  private applyBudgetWarning(task: Task, nodeRunId: string): void {
    const costs = this.usage.summarize(task.id);
    const budget = budgetStatus({
      actualCostUsd: costs.actualCostUsd,
      maxActualCostUsd: task.maxActualCostUsd,
    });
    if (!budget.warning) return;

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

  /**
   * Decides whether the verifier is sending the work back, returning the reason
   * or `undefined` to accept.
   *
   * Two independent grounds. The deterministic one comes first: if the worktree
   * has no changes, the writer produced nothing regardless of how confidently it
   * reported success, and no model opinion should be able to wave that through.
   * The second is the verifier's own verdict.
   *
   * A reply with no parseable verdict is *not* treated as a rejection. The
   * required deterministic check already gates acceptance, so failing a run over
   * a formatting quirk would cost the user a loop for nothing; the missing
   * verdict is recorded on the finding instead.
   */
  private async verifierRejection(
    worktreePath: string,
    output: string,
  ): Promise<string | undefined> {
    const diff = await captureDiff(worktreePath).catch(() => undefined);
    if (diff && diff.changedFiles.length === 0) {
      return 'Verifier found no changes in the worktree — the writer reported success without editing any file.';
    }

    const verdict = parseVerifierVerdict(output);
    if (verdict.decision === 'needs_changes') {
      return `Verifier requested changes: ${verdict.reason ?? 'no reason given'}`;
    }
    return undefined;
  }

  /**
   * Node ids that finished on the most recent interrupted run of this task.
   * Only nodes that still exist in the pinned graph are eligible, so a version
   * mismatch can never resurrect a node the current graph does not have.
   */
  private resumableRun(taskId: string, graph: WorkflowGraph): string[] | undefined {
    const previous = this.db
      .prepare(
        "SELECT id, graph_version_id FROM graph_runs WHERE task_id = ? AND state = 'interrupted' ORDER BY created_at DESC LIMIT 1",
      )
      .get(taskId) as { id: string; graph_version_id: string } | undefined;
    if (!previous || previous.graph_version_id !== graph.version) return undefined;

    const known = new Set(graph.nodes.map((node) => node.id));
    const completed = (
      this.db
        .prepare(
          "SELECT DISTINCT node_key FROM node_runs WHERE graph_run_id = ? AND state = 'completed'",
        )
        .all(previous.id) as Array<{ node_key: string }>
    )
      .map((row) => row.node_key)
      .filter((id) => known.has(id));

    return completed.length ? completed : undefined;
  }

  private async executeGraph(
    task: Task,
    prepared: PreparedRun,
    controller: AbortController,
  ): Promise<void> {
    const { graphRunId, graph, worktreePath, baseCommit, resumeCompleted } = prepared;
    let executions = 0;

    const { results } = await runGraph(
      graph,
      async ({ node }) => {
        const role = node.role;
        if (controller.signal.aborted) throw new Error('Cancelled by operator');
        // Honour a pause before spending anything on the next node.
        await this.waitWhilePaused(task.id, controller.signal);
        executions += 1;
        if (executions > task.maxAttempts * graph.nodes.length) {
          throw new Error(`Exceeded max attempts budget (${task.maxAttempts})`);
        }
        this.assertBudget(task);

        const nodeRunId = randomUUID();
        this.db
          .prepare(
            'INSERT INTO node_runs (id, graph_run_id, node_key, state, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          )
          .run(nodeRunId, graphRunId, node.id, 'running', now(), now());

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
          // The adapter comes from the route invokeRole resolves per attempt, so
          // a failover mid-turn swaps the adapter too.
          const prompt =
            role === 'verifier'
              ? [
                  `VERIFIER for RoleFlock task "${task.title}" (read-only). Do not modify files.`,
                  'Judge whether the writer\'s change actually satisfies the brief.',
                  'End your reply with exactly one line:',
                  '  VERDICT: PASS',
                  'or',
                  '  VERDICT: NEEDS_CHANGES — <one sentence on what is missing>',
                  '',
                  compiled.promptBlock,
                ].join('\n')
              : `PLANNER for RoleFlock task "${task.title}" (read-only).\nDo not modify files.\n\n${compiled.promptBlock}`;

          const invoked = await this.invokeRole({
            role,
            task,
            graphRunId,
            nodeRunId,
            invocationId,
            prompt,
            cwd: worktreePath,
            signal: controller.signal,
            // A failover mid-turn changes who is running; reflect that in the
            // live view rather than leaving the original provider on screen.
            onRoute: (next) =>
              this.updateExecution(task, graphRunId, nodeRunId, role, phase, next),
          });
          const output = invoked.output;
          const served = invoked.route;

          const provenance = `${role} via ${served.providerDisplayName} / ${served.modelDisplayName}${
            served.effort ? ` (${served.effort})` : ''
          } · ${compiled.disclosure.totalTokens} ctx tokens${
            served.fallbackUsed ? ' · fallback' : ''
          }`;

          if (role === 'verifier') {
            const rejection = await this.verifierRejection(worktreePath, output);
            if (rejection) {
              this.evidence.addFinding({
                id: randomUUID(),
                taskId: task.id,
                nodeRunId,
                severity: 'warning',
                summary: `Verifier asked for changes — ${provenance}`,
                details: rejection,
                createdAt: now(),
              });
              this.appendEvent(task.id, 'node.verifier.needs_changes', {
                graphRunId,
                nodeRunId,
                reason: rejection,
              });
              // Classified so the runtime follows the verifier → writer edge
              // instead of failing the run outright.
              throw new NodeFailure(rejection, 'needs_changes');
            }
          }

          this.evidence.addFinding({
            id: randomUUID(),
            taskId: task.id,
            nodeRunId,
            severity: 'info',
            summary: provenance,
            details: output || task.brief,
            createdAt: now(),
          });
        } else if (role === 'reviewer') {
          if (route) {
            await this.invokeRole({
              role,
              task,
              graphRunId,
              nodeRunId,
              invocationId,
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
          await this.assertDocumentConflictsResolved(
            task,
            graphRunId,
            nodeRunId,
            baseCommit,
            controller,
          );
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
            const useAgent =
              !this.forceFake &&
              process.env.ROLEFLOCK_CURSOR_AGENT !== '0' &&
              route?.adapter instanceof CursorWriterAdapter &&
              (await route.adapter.hasAgentCli());

            const envelope = useAgent
              ? {
                  worktree: worktreePath,
                  allowedPaths: ['**'],
                  allowCommands: false,
                }
              : {
                  worktree: worktreePath,
                  allowedPaths: [relativeTarget],
                  allowCommands: false,
                };

            if (useAgent && route?.adapter instanceof CursorWriterAdapter) {
              const prompt = [
                'Implement the smallest sufficient bug fix in this repository worktree.',
                `Title: ${task.title}`,
                `Brief: ${task.brief}`,
                `Expected: ${task.expectedBehaviour ?? 'n/a'}`,
                `Actual: ${task.actualBehaviour ?? 'n/a'}`,
                'Stay inside this workspace. Prefer editing existing source over adding docs.',
                'Do not invent secrets or reach outside the worktree.',
              ].join('\n');
              await this.invokeRole({
                role,
                task,
                graphRunId,
                nodeRunId,
                invocationId,
                prompt,
                cwd: worktreePath,
                signal: controller.signal,
                permissionEnvelope: envelope,
                onRoute: (next) =>
                  this.updateExecution(task, graphRunId, nodeRunId, role, phase, next),
              });
            } else {
              const content = `# RoleFlock verified fix\n\n${task.brief}\n\nExpected: ${task.expectedBehaviour ?? 'n/a'}\nActual: ${task.actualBehaviour ?? 'n/a'}\nProvider: ${route?.providerDisplayName ?? 'leased filesystem writer'}\nVerification: ${task.verificationCommand ?? 'artefact-present / npm test / ROLEFLOCK_FORCE_FAKE'}\nMode: leased-fs-fallback\n`;
              if (route?.adapter instanceof CursorWriterAdapter) {
                await route.adapter.write(relativeTarget, content, envelope);
              } else {
                await writeFile(join(worktreePath, relativeTarget), content);
              }
            }

            const diff = await captureDiff(worktreePath);
            if (route?.adapter instanceof CursorWriterAdapter) {
              assertChangedPathsAllowed(envelope, diff.changedFiles);
            }
            this.evidence.addArtefact({
              id: randomUUID(),
              taskId: task.id,
              kind: 'diff',
              path: useAgent ? worktreePath : join(worktreePath, relativeTarget),
              contentRef: diff.patch,
              metadata: {
                changedFiles: diff.changedFiles,
                status: diff.status,
                providerId: route?.providerId,
                permissionEnvelope: envelope,
                durableLeaseId: leaseId,
                writerMode: useAgent ? 'cursor-agent' : 'fs-fallback',
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
          // A non-zero exit is a verification result, not an orchestration error:
          // it must still be recorded as evidence before the node fails.
          const { passed, exitCode, stdout, stderr } = await runCommand({
            command: verification.command,
            args: verification.args,
            cwd: worktreePath,
            sandboxRoot: worktreePath,
            timeoutMs: 60_000,
          }).then(
            (result) => ({
              passed: true,
              exitCode: result.exitCode ?? 0,
              stdout: result.stdout,
              stderr: result.stderr,
            }),
            (error: unknown) => {
              if (!(error instanceof CommandError)) throw error;
              return {
                passed: false,
                exitCode: error.result.exitCode ?? undefined,
                stdout: error.result.stdout,
                stderr: error.result.stderr,
              };
            },
          );
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
            // Classified explicitly so the runtime routes this back to the writer
            // instead of treating it as an unknown orchestration error.
            throw new NodeFailure(
              `Verification failed (${verification.label})${stderr ? `: ${stderr.slice(0, 400)}` : ''}`,
              'verification_failed',
            );
          }
        } else if (role === 'accept') {
          this.setTaskState(task.id, 'awaiting_acceptance');
          this.updateExecution(task, graphRunId, nodeRunId, role, 'awaiting_confirmation');
          const decision = await this.waitForAcceptance(task.id, controller.signal);
          if (decision === 'rejected') throw new Error('Human rejected the change');
        }

        this.invocations.updateStatus(invocationId, 'completed', 'success', now());
        // Deterministic nodes spend no provider quota, so nothing is metered
        // for them. Provider turns record their own usage in `invokeRole`,
        // where the CLI's reported numbers are still in hand.
        this.applyBudgetWarning(task, nodeRunId);
        this.db
          .prepare('UPDATE node_runs SET state = ?, completed_at = ?, outcome = ? WHERE id = ?')
          .run('completed', now(), 'success', nodeRunId);
        this.bus.publish('execution.updated', this.executions.getByTask(task.id));
        return { role, nodeRunId };
      },
      {
        signal: controller.signal,
        resumeCompleted,
        onNodeState: (nodeId, state, attempt) => {
          this.appendEvent(task.id, 'node.state', { graphRunId, nodeId, state, attempt });
          this.bus.publish('graph.node.updated', { taskId: task.id, graphRunId, nodeId, state });
        },
      },
    );

    const failed = results.find((r) => r.status === 'failed');
    const blocked = failed?.error instanceof ProviderUnavailableError ? failed.error : undefined;

    if (blocked) {
      // `interrupted`, not `failed`: the completed nodes are still good, so the
      // next start resumes from them once the operator has pointed the role at
      // a model that answers.
      this.db
        .prepare(
          `UPDATE graph_runs
             SET state = 'interrupted', completed_at = ?,
                 blocked_role = ?, blocked_reason = ?, blocked_detail = ?
           WHERE id = ?`,
        )
        .run(
          now(),
          blocked.role,
          blocked.refusals[0]?.reason ?? 'unavailable',
          JSON.stringify(blocked.refusals),
          graphRunId,
        );
    } else {
      this.db
        .prepare('UPDATE graph_runs SET state = ?, completed_at = ? WHERE id = ?')
        .run(failed ? 'failed' : 'completed', now(), graphRunId);
    }

    if (failed) {
      const message =
        failed.error instanceof Error
          ? failed.error.message
          : typeof failed.error === 'string'
            ? failed.error
            : `Node ${failed.nodeId} failed`;
      this.recordFailure(
        task.id,
        blocked ? `No provider available for ${blocked.role}` : `Node ${failed.nodeId} failed`,
        blocked
          ? `${message}\n\nChange the model for this role on the Roles page, then start the task again — it resumes from the steps that already finished.`
          : message,
      );
      if (!controller.signal.aborted) this.setTaskState(task.id, 'failed');
      throw failed.error instanceof Error ? failed.error : new Error(message);
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

  private async resolveRoute(role: RoutedRole): Promise<RoleRoute | null> {
    return this.router.route(role, { forceFake: this.forceFake });
  }

  /**
   * Runs a role turn, moving down its candidate list when a provider refuses in
   * a way a retry cannot fix.
   *
   * The distinction that matters: an exhausted quota, an unknown model, or a
   * dead session are all failures of *this candidate*, not of the task. Each
   * parks that provider+model and re-routes, so the run continues on the next
   * choice the user configured. Anything else — a genuine error from a healthy
   * provider — propagates, because silently trying a different model would hide
   * a real problem behind a worse answer.
   */
  private async invokeRole(input: {
    role: RoutedRole;
    task: Task;
    graphRunId: string;
    nodeRunId: string;
    invocationId: string;
    prompt: string;
    cwd: string;
    signal: AbortSignal;
    permissionEnvelope?: { worktree: string; allowedPaths: string[]; allowCommands?: boolean };
    onRoute?: (route: RoleRoute) => void;
  }): Promise<{ output: string; route: RoleRoute; usage?: ReportedUsage }> {
    const attempted = new Set<string>();
    const refusals: ProviderRefusal[] = [];

    for (;;) {
      const route = await this.resolveRoute(input.role);
      if (!route) {
        // Nothing the operator configured can serve this turn. Stop and say
        // what refused, rather than inventing an answer.
        //
        // A candidate that failed this turn is already in `refusals` with the
        // provider's own message; the router then reports it again as "cooling
        // down". Listing both would show the same model twice and bury the
        // message that explains it, so only genuinely untried candidates are
        // added here.
        const tried = new Set(refusals.map((r) => `${r.providerId}:${r.modelId}`));
        const untried = this.router
          .skippedFor(input.role)
          .filter((skip) => !tried.has(`${skip.providerId}:${skip.modelId}`))
          .map((skip) => ({
            providerId: skip.providerId,
            providerDisplayName: skip.providerId,
            modelId: skip.modelId,
            modelDisplayName: skip.modelId,
            reason: skip.reason,
            detail: skip.detail ?? '',
          }));
        throw new ProviderUnavailableError(input.role, [...refusals, ...untried]);
      }
      const key = `${route.providerId}:${route.modelId}`;

      // The router can only skip what it knows is unavailable. If it hands back
      // a candidate this turn already tried, the list is exhausted.
      if (attempted.has(key)) {
        throw new ProviderUnavailableError(input.role, [...refusals]);
      }
      attempted.add(key);
      input.onRoute?.(route);

      try {
        const invoked = await this.consumeInvocation({
          adapter: route.adapter,
          invocationId: input.invocationId,
          nodeRunId: input.nodeRunId,
          prompt: input.prompt,
          cwd: input.cwd,
          signal: input.signal,
          permissionEnvelope: input.permissionEnvelope,
          model: route.modelId,
          effort: route.effort,
        });
        this.recordUsage({
          task: input.task,
          nodeRunId: input.nodeRunId,
          invocationId: input.invocationId,
          route,
          usage: invoked.usage,
        });
        return { output: invoked.output, route, usage: invoked.usage };
      } catch (error) {
        if (input.signal.aborted) throw error;

        const message = error instanceof Error ? error.message : String(error);
        const kind = classifyProviderFailure(message);
        const until = this.router.recordFailure(
          input.role,
          route.providerId,
          route.modelId,
          kind,
          message,
        );
        if (!until) throw error;

        refusals.push({
          providerId: route.providerId,
          providerDisplayName: route.providerDisplayName,
          modelId: route.modelId,
          modelDisplayName: route.modelDisplayName,
          reason: kind,
          detail: message.slice(0, 400),
          until,
        });

        this.evidence.addFinding({
          id: randomUUID(),
          taskId: input.task.id,
          nodeRunId: input.nodeRunId,
          severity: 'warning',
          summary: `${route.providerDisplayName} / ${route.modelDisplayName} unavailable (${kind.replaceAll('_', ' ')})`,
          details: `Paused until ${until}. Falling back to the next candidate for ${input.role}. ${message.slice(0, 400)}`,
          createdAt: now(),
        });
        this.appendEvent(input.task.id, 'role.failover', {
          graphRunId: input.graphRunId,
          nodeRunId: input.nodeRunId,
          role: input.role,
          from: { providerId: route.providerId, modelId: route.modelId },
          reason: kind,
          until,
        });
        this.bus.publish('role.failover', {
          taskId: input.task.id,
          role: input.role,
          providerId: route.providerId,
          modelId: route.modelId,
          reason: kind,
          until,
        });
      }
    }
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
    model?: string;
    effort?: Effort;
  }): Promise<{ output: string; usage?: ReportedUsage }> {
    let output = '';
    let usage: ReportedUsage | undefined;
    try {
      for await (const event of input.adapter.invoke({
        invocationId: input.invocationId,
        prompt: input.prompt,
        cwd: input.cwd,
        signal: this.invocationSignal(input.signal),
        permissionEnvelope: input.permissionEnvelope,
        model: input.model,
        effort: input.effort,
        onSpawn: (pid) => {
          this.processHandles.create({
            id: randomUUID(),
            nodeRunId: input.nodeRunId,
            invocationId: input.invocationId,
            pid,
            // No pgid: these children are not spawned detached, so they share
            // the daemon's process group. Killing "their" group would signal
            // the daemon itself.
            status: 'running',
            startedAt: now(),
            lastHeartbeatAt: now(),
          });
        },
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
        // The CLI's own numbers. Anything shown as a token count or a cost has
        // to come from here rather than from a plausible-looking constant.
        if (event.type === 'usage.updated') usage = event.usage as ReportedUsage;
        if (event.type === 'invocation.failed') {
          throw new Error(event.error.message);
        }
        if (event.type === 'invocation.interrupted') {
          throw new Error(event.reason);
        }
      }
    } catch (error) {
      this.closeProcessHandles(input.nodeRunId, 'unknown');
      if (input.signal.aborted) throw new Error('Cancelled by operator', { cause: error });
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(
          `Provider invocation timed out after ${this.providerTimeoutMs()}ms (set ROLEFLOCK_PROVIDER_TIMEOUT_MS to adjust)`,
          { cause: error },
        );
      }
      throw error;
    }
    this.closeProcessHandles(input.nodeRunId, 'terminated');
    return { output, usage };
  }

  /** Marks any handle for a node as finished, so it is not reconciled later. */
  private closeProcessHandles(nodeRunId: string, status: 'terminated' | 'unknown'): void {
    for (const handle of this.processHandles.listRunning()) {
      if (handle.nodeRunId === nodeRunId) {
        this.processHandles.setStatus(handle.id, status, now());
      }
    }
  }

  /**
   * Waits while the operator has the task paused.
   *
   * Pause previously set a flag nothing read: the projection said "paused" and
   * the graph kept spending quota. It is checked between nodes rather than
   * mid-turn because a provider turn cannot be suspended — stopping one means
   * killing it, which is what Stop is for.
   */
  private async waitWhilePaused(taskId: string, signal: AbortSignal): Promise<void> {
    for (;;) {
      if (signal.aborted) throw new Error('Cancelled by operator');
      if (this.tasks.get(taskId)?.state !== 'paused') return;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
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

  private async resolveVerification(task: Task, worktreePath: string): Promise<VerificationSpec> {
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

  private waitForAcceptance(taskId: string, signal: AbortSignal): Promise<'accepted' | 'rejected'> {
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

  private waitForConfirmation(id: string, signal: AbortSignal): Promise<'approved' | 'rejected'> {
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
    // Null when no provider could be resolved for the turn; the projection
    // falls back to placeholder names rather than claiming a provider ran.
    route?: RoleRoute | null,
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
      providerConnectionId: route?.providerId ?? 'deterministic',
      providerDisplayName: route?.providerDisplayName ?? mapping.provider,
      configuredModelId: route?.modelId ?? mapping.model,
      configuredModelDisplayName: route?.modelDisplayName ?? mapping.model,
      effort: 'standard',
      phase,
      permissionProfileId: role === 'writer' ? 'worktree-write' : 'read-only',
      currentActivity: route?.fallbackUsed ? `${role} executing (fallback)` : `${role} executing`,
      activeCommandPreview: role === 'test' ? 'verification command' : undefined,
      startedAt: timestamp,
      lastHeartbeatAt: timestamp,
      attempt: 1,
      maxAttempts: task.maxAttempts,
      actualCost: costs.actualCostUsd,
      shadowCost: costs.shadowCostUsd,
      // A deterministic node spends no provider quota, so its cost really is
      // exactly zero. A provider turn overwrites this from what the CLI reported.
      usageConfidence: route ? 'estimated' : 'exact',
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

export interface VerifierVerdict {
  decision: 'pass' | 'needs_changes' | 'inconclusive';
  reason?: string;
}

/**
 * Reads the verdict line the verifier prompt asks for. The last verdict wins:
 * a model that restates the required format before answering would otherwise
 * have its example parsed as the answer.
 */
export function parseVerifierVerdict(output: string | undefined): VerifierVerdict {
  const matches = [...(output ?? '').matchAll(/VERDICT:\s*(PASS|NEEDS[_\s]CHANGES)\b[^\S\n]*(?:[—–:-]\s*)?([^\n]*)/gi)];
  const last = matches.at(-1);
  if (!last) return { decision: 'inconclusive' };

  const decision = /needs/i.test(last[1] ?? '') ? 'needs_changes' : 'pass';
  const reason = last[2]?.trim();
  return { decision, reason: reason || undefined };
}

const GRAPH_MODES: readonly GraphMode[] = ['direct', 'fast', 'standard', 'bug_fix', 'critical'];

/**
 * Pins a task to the graph version it was created with. Tasks written before
 * graph versioning stored a bare mode (`bug_fix`); those still resolve, but new
 * runs are recorded against an explicit `mode@version`.
 */
export function resolveTaskGraph(task: Task): WorkflowGraph {
  const stored = task.workflowGraphVersionId ?? '';
  const [mode] = stored.split('@');
  if (GRAPH_MODES.includes(mode as GraphMode)) return getWorkflowGraph(stored);
  return getWorkflowGraph(graphVersionId(task.type === 'bug_fix' ? 'bug_fix' : 'standard'));
}
