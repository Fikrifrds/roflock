import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ActiveExecution,
  ConfirmationRequest,
  Task,
  UsageConfidence,
} from '@roleflock/contracts';
import { createConfirmationRequest, matchingGrant } from '@roleflock/approval-engine';
import {
  buildPinnedArtifactContext,
  buildRepositoryMap,
  compileContext,
  type RoleId,
} from '@roleflock/context-compiler';
import {
  assertExecutorChangedPaths,
  classifyMechanicalFailure,
  compilePlannerPlanProposal,
  evaluateRepairEnvelope,
  executorInstructionBlock,
  executorPermissionEnvelope,
  parseApprovedExecutionPlan,
  plannerStructuredOutputPrompt,
  type ChangeContract,
  type ExecutionPlan,
} from '@roleflock/change-contracts';
import {
  ActiveExecutionRepository,
  ApprovalGrantRepository,
  AuditRepository,
  ChangeContractRepository,
  ChangePassportRepository,
  ConfirmationRepository,
  ConcurrencyPolicyRepository,
  ControlCommandRepository,
  EvidenceRepository,
  EventStore,
  ExecutionPlanRepository,
  InvocationRepository,
  LeaseRepository,
  LocalKnowledgeRepository,
  ProcessHandleRepository,
  RunnerIdentityRepository,
  TaskRepository,
  UsageRepository,
  VerificationResultRepository,
  VerificationSpecificationRepository,
  WorktreeRepository,
  type SqliteDb,
} from '@roleflock/database';
import { runCommand, CommandError, parseCommandArgv } from '@roleflock/command-runner';
import {
  getWorkflowGraph,
  graphVersionId,
  validateGraph,
  workflowGraphs,
  type GraphMode,
  type WorkflowGraph,
} from '@roleflock/graph-core';
import { NodeFailure, runGraph, type NodeContext } from '@roleflock/graph-runtime';
import {
  captureDiff,
  prepareTaskWorkspace,
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
import {
  freezeVerificationSpecification,
  type VerificationDecision,
  type VerificationSpecification,
} from '@roleflock/verification-runner';
import type { SecretStore } from '@roleflock/secret-store';
import { EventBus } from './event-bus.js';
import { issueTaskChangePassport } from './change-passport-issuance.js';
import { authoritativeConflictMessage, type DocumentService } from './documents.js';
import { runIndependentVerification } from './independent-verification.js';
import { applyModelPatch, buildPatchWriterContext } from './model-patch.js';
import { loadPriceCards } from './pricing.js';
import { ProviderRegistry } from './provider-registry.js';
import {
  describeSealedCommit,
  sealResultCommit,
  resolveRepositoryRoot,
  type SealedResultCommit,
} from './result-commit.js';
import { RoleRouter, type RoleRoute, type RoutedRole } from './role-routing.js';
import { discoverVerificationCommand } from './verification-command.js';

/**
 * How long a provider may stay silent before its turn is abandoned.
 *
 * This is an idle budget, not a wall clock. A CLI that is still streaming is
 * still working, and a real planner or writer turn routinely runs longer than
 * any fixed cap worth setting — the old 90s wall clock killed healthy turns
 * a minute and a half in.
 */
const DEFAULT_PROVIDER_IDLE_TIMEOUT_MS = 300_000;
const DEFAULT_VERIFICATION_TIMEOUT_MS = 300_000;

export function providerIdleTimeoutMs(): number {
  const raw = Number(
    process.env.ROLEFLOCK_PROVIDER_IDLE_TIMEOUT_MS ??
      process.env.ROLEFLOCK_PROVIDER_TIMEOUT_MS ??
      DEFAULT_PROVIDER_IDLE_TIMEOUT_MS,
  );
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PROVIDER_IDLE_TIMEOUT_MS;
}

export function verificationTimeoutMs(): number {
  const raw = Number(
    process.env.ROLEFLOCK_VERIFICATION_TIMEOUT_MS ?? DEFAULT_VERIFICATION_TIMEOUT_MS,
  );
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_VERIFICATION_TIMEOUT_MS;
}

function approvedPlanFromCompleted(
  completed: readonly { output?: unknown }[],
): ExecutionPlan | undefined {
  for (const result of [...completed].reverse()) {
    const wrapper =
      typeof result.output === 'object' && result.output !== null
        ? (result.output as { output?: unknown })
        : undefined;
    for (const candidate of [wrapper?.output, result.output]) {
      try {
        const value = typeof candidate === 'string' ? JSON.parse(candidate) : candidate;
        return parseApprovedExecutionPlan(value);
      } catch {
        // Other node outputs are intentionally ignored; only a verified
        // approved Execution Plan can become the executor's authority.
      }
    }
  }
  return undefined;
}

export interface IdleWatchdog {
  /** Fires when the operator aborts or the silence budget runs out. */
  signal: AbortSignal;
  /** Restarts the budget; call on every sign of life from the provider. */
  touch: () => void;
  /** True when it was the budget, not the operator, that ended the turn. */
  expired: () => boolean;
  dispose: () => void;
}

/**
 * Arms the silence budget for one provider turn.
 *
 * The adapter is handed a single merged signal and cannot tell the operator's
 * Stop apart from an expired budget, which is why `expired()` exists: without
 * it a timeout arrived labelled "Cancelled by operator", classified as
 * `cancelled`, and skipped every retry the workflow was given.
 */
export function createIdleWatchdog(parent: AbortSignal, budgetMs: number): IdleWatchdog {
  const idle = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const touch = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => idle.abort(), budgetMs);
    timer.unref?.();
  };
  touch();
  return {
    signal: AbortSignal.any([parent, idle.signal]),
    touch,
    expired: () => idle.signal.aborted,
    dispose: () => {
      if (timer) clearTimeout(timer);
    },
  };
}

/**
 * A provider turn abandoned because the CLI stopped producing output.
 *
 * Classified as a timeout rather than left to the heuristic in `classifyFailure`,
 * so the run follows its `on_timeout` edge and spends the retries the workflow
 * declared. It is also deliberately not a provider refusal: going quiet once
 * says nothing about the model's health, so the router must not park it.
 */
export class ProviderIdleTimeoutError extends NodeFailure {
  constructor(
    readonly idleMs: number,
    options?: { cause?: unknown },
  ) {
    super(
      `Provider timed out: no output for ${idleMs}ms (set ROLEFLOCK_PROVIDER_IDLE_TIMEOUT_MS to adjust)`,
      'timeout',
      options,
    );
    this.name = 'ProviderIdleTimeoutError';
  }
}

export class ConcurrencyLimitError extends Error {
  constructor(
    readonly scope: 'global' | 'project',
    readonly activeCount: number,
    readonly limit: number,
  ) {
    super(
      `${scope === 'global' ? 'Global' : 'Project'} concurrency limit reached (${activeCount}/${limit})`,
    );
    this.name = 'ConcurrencyLimitError';
  }
}

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
          .map(
            (r) =>
              `${r.providerDisplayName}/${r.modelDisplayName} (${r.reason.replaceAll('_', ' ')})`,
          )
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
  private readonly verificationSpecifications: VerificationSpecificationRepository;
  private readonly worktrees: WorktreeRepository;
  private readonly events: EventStore;
  private readonly confirmations: ConfirmationRepository;
  private readonly concurrency: ConcurrencyPolicyRepository;
  private readonly changeContracts: ChangeContractRepository;
  private readonly executionPlans: ExecutionPlanRepository;
  private readonly verificationResults: VerificationResultRepository;
  private readonly passports: ChangePassportRepository;
  private readonly runnerIdentities: RunnerIdentityRepository;
  private readonly invocations: InvocationRepository;
  private readonly leases: LeaseRepository;
  private readonly processHandles: ProcessHandleRepository;
  private readonly worktreeBaseDir: string;
  private readonly providers?: ProviderRegistry;
  private readonly documents?: DocumentService;
  /** Holds the passport signing key. Absent in tests that never issue one. */
  private readonly signingSecrets?: SecretStore;
  /**
   * The independent verification a run produced, keyed by task, so acceptance
   * can bind a passport to the exact commit that was verified.
   */
  private readonly verificationRuns = new Map<
    string,
    {
      sealed: SealedResultCommit;
      decision: VerificationDecision;
      networkEnforcement: 'enforced' | 'unenforced';
      isolationProvider: string;
    }
  >();
  private readonly forceFake: boolean;
  private readonly documentConflictResolved = new Set<string>();
  readonly router: RoleRouter;

  constructor(
    private readonly db: SqliteDb,
    private readonly bus: EventBus,
    worktreeBaseDir: string,
    providers?: ProviderRegistry,
    documents?: DocumentService,
    signingSecrets?: SecretStore,
  ) {
    this.tasks = new TaskRepository(db);
    this.executions = new ActiveExecutionRepository(db);
    this.commands = new ControlCommandRepository(db);
    this.evidence = new EvidenceRepository(db);
    this.usage = new UsageRepository(db);
    this.verificationSpecifications = new VerificationSpecificationRepository(db);
    this.worktrees = new WorktreeRepository(db);
    this.events = new EventStore(db);
    this.confirmations = new ConfirmationRepository(db);
    this.concurrency = new ConcurrencyPolicyRepository(db);
    this.changeContracts = new ChangeContractRepository(db);
    this.executionPlans = new ExecutionPlanRepository(db);
    this.verificationResults = new VerificationResultRepository(db);
    this.passports = new ChangePassportRepository(db);
    this.runnerIdentities = new RunnerIdentityRepository(db);
    this.invocations = new InvocationRepository(db);
    this.leases = new LeaseRepository(db);
    this.processHandles = new ProcessHandleRepository(db);
    this.worktreeBaseDir = worktreeBaseDir;
    this.providers = providers;
    this.documents = documents;
    this.signingSecrets = signingSecrets;
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

    const admission = this.concurrency.tryAcquire(task.id, task.projectId, now());
    if (!admission.admitted) {
      throw new ConcurrencyLimitError(admission.limitingScope, admission.active, admission.limit);
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
          this.concurrency.release(task.id, now());
        });
      return { graphRunId: prepared.graphRunId };
    } catch (error) {
      this.active.delete(task.id);
      this.concurrency.release(task.id, now());
      const message = error instanceof Error ? error.message : 'Task failed to start';
      this.recordFailure(task.id, 'Task failed to start', message);
      this.setTaskState(task.id, 'failed');
      throw error;
    }
  }

  isActive(taskId: string): boolean {
    return this.active.has(taskId);
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
    }
    this.commands.updateStatus(id, 'completed', { completedAt: now() });
    this.bus.publish('control.commanded', { taskId, commandType });
  }

  /**
   * Records the human's acceptance and, when it is an approval, issues the
   * passport bound to it.
   *
   * Issuance lives here rather than in the accept node because the node only
   * exists while a graph run is alive. A reviewer who decides after a restart
   * is making the same decision and must get the same artifact.
   */
  async resolveAcceptance(taskId: string, decision: 'accepted' | 'rejected'): Promise<void> {
    this.setTaskState(taskId, decision);
    this.acceptanceWaiters.get(taskId)?.resolve(decision);
    this.acceptanceWaiters.delete(taskId);
    if (decision !== 'accepted') return;
    await this.issuePassportForAcceptance({
      taskId,
      nodeRunId: this.executions.getByTask(taskId)?.nodeRunId ?? `acceptance_${taskId}`,
    });
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

  private currentContract(taskId: string): ChangeContract | undefined {
    const aggregate = this.changeContracts.getByTask(taskId);
    if (aggregate === undefined) return undefined;
    const stored = this.changeContracts.getCurrent(aggregate.id);
    if (
      stored === undefined ||
      stored.contract.status !== 'authorised' ||
      stored.contract.hash !== aggregate.currentHash
    ) {
      return undefined;
    }
    return stored.contract;
  }

  /** The current plan, only when it is approved and bound to the live contract. */
  private approvedPlan(taskId: string, contract: ChangeContract): ExecutionPlan | undefined {
    const current = this.executionPlans.getByTask(taskId);
    if (current === undefined) return undefined;
    const { plan } = current;
    return plan.status === 'approved' && plan.contractHash === contract.hash ? plan : undefined;
  }

  /**
   * The three artifacts independent verification cannot run without.
   *
   * All present means the task carries authorised intent, an approved plan, and
   * a specification frozen against both — the only state in which a
   * clean-runner verdict can mean anything. Any missing piece leaves the task
   * on the unassured path, which the UI labels as such rather than hiding.
   */
  private assuranceInputs(taskId: string):
    | {
        contract: ChangeContract;
        plan: ExecutionPlan;
        specification: Readonly<VerificationSpecification>;
      }
    | undefined {
    const contract = this.currentContract(taskId);
    if (contract === undefined) return undefined;
    const plan = this.approvedPlan(taskId, contract);
    if (plan === undefined) return undefined;
    const stored = this.verificationSpecifications.getByTask(taskId);
    if (stored === undefined) return undefined;
    try {
      return {
        contract,
        plan,
        specification: freezeVerificationSpecification(stored, contract, plan),
      };
    } catch {
      // A specification that no longer binds to the current contract and plan
      // is not a usable verification input; the run falls back to the
      // unassured path rather than verifying against stale intent.
      return undefined;
    }
  }

  /**
   * Names the assurance inputs a task is missing, in the order a user has to
   * supply them.
   *
   * Only used to explain a refusal. "Independent verification is unavailable"
   * gives someone nothing to act on, whereas naming the missing artifact points
   * at the exact screen that resolves it.
   */
  private missingAssuranceInputs(taskId: string): string[] {
    const contract = this.currentContract(taskId);
    if (contract === undefined) return ['an authorised Change Contract'];
    const missing: string[] = [];
    const plan = this.approvedPlan(taskId, contract);
    if (plan === undefined) missing.push('an approved Execution Plan bound to that contract');
    const stored = this.verificationSpecifications.getByTask(taskId);
    if (stored === undefined) {
      missing.push('a Verification Specification');
      return missing;
    }
    if (plan !== undefined) {
      try {
        freezeVerificationSpecification(stored, contract, plan);
      } catch (error) {
        missing.push(
          `a Verification Specification that still binds to the current contract and plan (${error instanceof Error ? error.message : String(error)})`,
        );
      }
    }
    return missing;
  }

  /**
   * Runs the frozen specification against the sealed result commit in a clean
   * worktree and stores the criterion verdicts.
   *
   * Returns `undefined` when the task has no assurance inputs, which leaves the
   * caller on the legacy executor-side check.
   */
  private async runAssuredVerification(input: {
    task: Task;
    graphRunId: string;
    nodeRunId: string;
    worktreePath: string;
    baseCommit: string;
  }): Promise<
    { sealed: SealedResultCommit; decision: VerificationDecision; passed: boolean } | undefined
  > {
    const task = input.task;
    const inputs = this.assuranceInputs(task.id);
    if (inputs === undefined) return undefined;

    this.publishLiveProgress(input.nodeRunId, {
      activity: 'Sealing result commit for independent verification',
    });
    const sealed = await sealResultCommit({
      worktreePath: input.worktreePath,
      taskId: task.id,
      baseCommit: input.baseCommit,
      message: `RoleFlock verification subject for task ${task.id}`,
    });
    const repositoryRoot = await resolveRepositoryRoot(input.worktreePath);
    const identity = await this.ensureRunnerIdentity();

    this.publishLiveProgress(input.nodeRunId, {
      activity: `Verifying ${sealed.resultCommit.slice(0, 10)} in a clean worktree`,
      append: `$ verifying ${inputs.specification.checks.length} frozen check(s) against ${sealed.resultCommit.slice(0, 10)}\n`,
    });
    this.appendEvent(task.id, 'verification.started', {
      graphRunId: input.graphRunId,
      nodeRunId: input.nodeRunId,
      specificationHash: inputs.specification.hash,
      resultCommit: sealed.resultCommit,
    });

    const outcome = await runIndependentVerification({
      specification: inputs.specification,
      contract: inputs.contract,
      plan: inputs.plan,
      repositoryRoot,
      repositoryId: task.projectId,
      verifierBaseDirectory: join(this.worktreeBaseDir, 'verification'),
      runId: `${task.id}-${input.nodeRunId}`,
      baseCommit: input.baseCommit,
      resultCommit: sealed.resultCommit,
      runnerIdentity: { runnerId: identity.id, trustLevel: 'clean_local_runner' },
      decisionId: randomUUID(),
    });

    this.verificationResults.create({
      decision: outcome.decision,
      attestations: outcome.attestations,
    });
    this.verificationRuns.set(task.id, {
      sealed,
      decision: outcome.decision,
      networkEnforcement: outcome.networkEnforcement,
      isolationProvider: outcome.isolationProvider,
    });

    for (const verdict of outcome.decision.verdicts) {
      if (verdict.outcome === 'pass') continue;
      this.evidence.addFinding({
        id: randomUUID(),
        taskId: task.id,
        nodeRunId: input.nodeRunId,
        severity: verdict.outcome === 'fail' ? 'error' : 'warning',
        summary: `Criterion ${verdict.criterionId}: ${verdict.outcome.replaceAll('_', ' ')}`,
        details: verdict.explanation,
        createdAt: now(),
      });
    }
    this.appendEvent(task.id, 'verification.completed', {
      graphRunId: input.graphRunId,
      nodeRunId: input.nodeRunId,
      decisionHash: outcome.decision.hash,
      outcome: outcome.decision.overallOutcome,
      resultCommit: sealed.resultCommit,
    });

    return {
      sealed,
      decision: outcome.decision,
      passed: outcome.decision.overallOutcome === 'pass',
    };
  }

  /**
   * The verified subject for a task, from this run's memory when it is still
   * warm and from durable evidence when it is not.
   *
   * The rebuild path matters because acceptance is a human step: the daemon can
   * restart between verification and the reviewer's decision, and a passport
   * that silently goes missing for that reason would punish the reviewer for a
   * process detail they never saw.
   */
  private async verificationSubject(taskId: string): Promise<
    | {
        sealed: { resultCommit: string; treeDigest: string; diffDigest: string };
        decision: VerificationDecision;
        networkEnforcement: 'enforced' | 'unenforced';
        isolationProvider: string;
      }
    | undefined
  > {
    const warm = this.verificationRuns.get(taskId);
    if (warm) return warm;

    const stored = this.verificationResults.getLatest(taskId);
    const worktree = this.worktrees.getByTask(taskId);
    if (stored === undefined || worktree === undefined || !existsSync(worktree.path)) {
      return undefined;
    }
    try {
      const described = await describeSealedCommit({
        worktreePath: worktree.path,
        baseCommit: stored.decision.subject.baseCommit,
        resultCommit: stored.decision.subject.resultCommit,
      });
      return {
        sealed: {
          resultCommit: stored.decision.subject.resultCommit,
          treeDigest: described.treeDigest,
          diffDigest: described.diffDigest,
        },
        decision: stored.decision,
        // Recovered evidence cannot prove the isolation the original run had,
        // so it claims none rather than inheriting an unverifiable assumption.
        networkEnforcement: 'unenforced',
        isolationProvider: 'roleflock.unenforced_local',
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Issues the signed Change Passport for an accepted task.
   *
   * Silent by design when the run has no independent verification behind it:
   * a passport is a claim that evidence exists, so the absence of evidence must
   * produce no passport rather than a weaker one.
   */
  private async issuePassportForAcceptance(input: {
    taskId: string;
    nodeRunId: string;
  }): Promise<void> {
    if (this.signingSecrets === undefined) return;
    const task = this.tasks.get(input.taskId);
    if (task === undefined) return;
    const run = await this.verificationSubject(task.id);
    if (run === undefined) return;
    const inputs = this.assuranceInputs(task.id);
    if (inputs === undefined) return;

    try {
      const passport = await issueTaskChangePassport(
        {
          passports: this.passports,
          identities: this.runnerIdentities,
          secrets: this.signingSecrets,
        },
        {
          taskId: task.id,
          repositoryId: task.projectId,
          contract: inputs.contract,
          plan: inputs.plan,
          specification: inputs.specification,
          decision: run.decision,
          acceptance: {
            actorId: 'local-user',
            decidedAt: now(),
            nodeRunId: input.nodeRunId,
          },
          subject: {
            baseCommit: run.decision.subject.baseCommit,
            resultCommit: run.sealed.resultCommit,
            treeDigest: run.sealed.treeDigest,
            diffDigest: run.sealed.diffDigest,
          },
          events: this.events.list(task.id),
          networkEnforcement: run.networkEnforcement,
          isolationProvider: run.isolationProvider,
          blockingDeviations: this.executionPlans.listDeviations(task.id).map((deviation) => ({
            id: deviation.id,
            hash: deviation.hash,
            status: deviation.status,
          })),
          issuedAt: now(),
        },
      );
      this.appendEvent(task.id, 'passport.issued', {
        passportId: passport.passportId,
        verdict: passport.verdict,
        resultCommit: passport.resultCommit,
      });
      this.bus.publish('passport.issued', {
        taskId: task.id,
        passportId: passport.passportId,
        verdict: passport.verdict,
      });
    } catch (error) {
      // Issuance refused because some binding drifted. That is a truthful
      // outcome, not a run failure: the change is accepted, it simply carries
      // no portable assurance, and the reviewer is told exactly why.
      this.evidence.addFinding({
        id: randomUUID(),
        taskId: task.id,
        nodeRunId: input.nodeRunId,
        severity: 'warning',
        summary: 'No Change Passport was issued for this acceptance',
        details: error instanceof Error ? error.message : String(error),
        createdAt: now(),
      });
    }
  }

  private async ensureRunnerIdentity(): Promise<{ id: string }> {
    const existing = this.runnerIdentities.getActiveLocal();
    if (existing) return existing;
    if (this.signingSecrets === undefined) {
      // Verification still runs and still produces attestations; it simply
      // names an unsigned local runner until a signing store is configured.
      return { id: 'local_clean_runner' };
    }
    const { LocalRunnerIdentityService } = await import('@roleflock/change-passport');
    return new LocalRunnerIdentityService(
      this.runnerIdentities,
      this.signingSecrets,
    ).ensureIdentity();
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
    const resume = this.resumableRun(task, graph);
    const existingWorktree = resume ? this.worktrees.getByTask(task.id) : undefined;
    const reusable =
      existingWorktree &&
      (existingWorktree.status === 'active' || existingWorktree.status === 'dirty_preserved') &&
      existsSync(existingWorktree.path)
        ? existingWorktree
        : undefined;

    let worktree: { path: string; branchName: string; baseCommit: string };
    if (reusable) {
      if (reusable.status !== 'active') this.worktrees.setStatus(task.id, 'active');
      worktree = {
        path: reusable.path,
        branchName: reusable.branchName,
        baseCommit: reusable.baseCommit,
      };
    } else {
      const repo = await registerRepository(repositoryPath);
      try {
        // Recover an existing external workspace when possible. Every new run
        // otherwise gets its own external worktree; the primary checkout and
        // its current branch remain untouched.
        const prior = this.worktrees.getByTask(task.id);
        const reuseExternal =
          prior &&
          prior.path !== repo.root &&
          existsSync(prior.path) &&
          (prior.status === 'active' || prior.status === 'dirty_preserved');

        worktree = reuseExternal
          ? {
              path: prior.path,
              branchName: prior.branchName,
              baseCommit: prior.baseCommit,
            }
          : await prepareTaskWorkspace(repo, task.id, {
              mode: 'external',
              baseRef: baseBranch === 'HEAD' ? 'HEAD' : baseBranch,
              worktreeBaseDir: this.worktreeBaseDir,
            });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to prepare external task workspace: ${detail}`, { cause: error });
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
    if (reusable && resume?.completed.length) {
      const timestamp = now();
      const insert = this.db.prepare(
        `INSERT INTO node_runs
          (id, graph_run_id, node_key, state, started_at, completed_at, outcome, created_at)
         VALUES (?, ?, ?, 'completed', ?, ?, 'resumed from previous run', ?)`,
      );
      for (const nodeId of resume.completed) {
        insert.run(randomUUID(), graphRunId, nodeId, timestamp, timestamp, timestamp);
      }
    }
    this.setTaskState(task.id, 'running');
    if (this.forceFake) {
      this.evidence.addFinding({
        id: randomUUID(),
        taskId: task.id,
        severity: 'warning',
        summary: 'Simulation mode — no real provider or repository fix was verified',
        details:
          'ROLEFLOCK_FORCE_FAKE=1 uses scripted model output, creates a demonstration artefact, and runs only a simulation check. Do not treat this run as production evidence.',
        createdAt: now(),
      });
    }
    const bootstrapNode = graph.nodes[0]?.id ?? 'planner';
    this.updateExecution(task, graphRunId, randomUUID(), bootstrapNode, 'preparing');
    this.bus.publish('task.started', { taskId: task.id, graphRunId });
    return {
      graphRunId,
      graph,
      worktreePath: worktree.path,
      baseCommit: worktree.baseCommit,
      resumeCompleted: reusable ? resume?.completed : undefined,
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
      execution.inputTokens = costs.inputTokens;
      execution.outputTokens = costs.outputTokens;
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
  private resumableRun(task: Task, graph: WorkflowGraph): { completed: string[] } | undefined {
    const resumableStates =
      task.state === 'cancelled' ? "('interrupted', 'failed', 'cancelled')" : "('interrupted')";
    const previous = this.db
      .prepare(
        `SELECT id, graph_version_id FROM graph_runs
         WHERE task_id = ? AND state IN ${resumableStates}
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(task.id) as { id: string; graph_version_id: string } | undefined;
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

    return {
      // Before a writer finishes, rerunning the planning context is safer than
      // skipping into a later role with no prior-turn output. Once code exists,
      // preserve it and continue at the first unfinished verification gate.
      completed: task.state === 'cancelled' && !completed.includes('writer') ? [] : completed,
    };
  }

  private async executeGraph(
    task: Task,
    prepared: PreparedRun,
    controller: AbortController,
  ): Promise<void> {
    const { graphRunId, graph, worktreePath, baseCommit, resumeCompleted } = prepared;
    let executions = 0;
    let activeApprovedPlan: ExecutionPlan | undefined;

    // The rows the node body has opened but not closed, keyed by node id. A
    // failing node used to leave both of them on `running` for good, and the run
    // graph reads exactly those rows — so the UI kept showing a node at work
    // under a task it already called failed.
    const openRuns = new Map<string, { nodeRunId: string; invocationId: string }>();

    const executeNode = async ({
      node,
      completed,
    }: NodeContext): Promise<{
      role: string;
      nodeRunId: string;
      output?: string;
      artifacts?: Array<{
        id: string;
        kind: 'execution_plan';
        status: string;
        hash: string;
        valid: boolean;
        current: boolean;
      }>;
    }> => {
      openRuns.delete(node.id);
      const role = node.role;
      const contract = this.currentContract(task.id);
      const pinnedPlan =
        node.authorityRole === 'executor' ? approvedPlanFromCompleted(completed) : undefined;
      if (node.authorityRole === 'executor' && pinnedPlan === undefined) {
        throw new Error('Executor cannot start without one current approved Execution Plan');
      }
      let pinnedVerification: Readonly<VerificationSpecification> | undefined;
      if (pinnedPlan !== undefined) {
        if (contract === undefined) {
          throw new Error('Executor cannot start without the current authorised contract');
        }
        const specification = this.verificationSpecifications.getByTask(task.id);
        if (specification === undefined) {
          throw new Error('Executor cannot start without a frozen Verification Specification');
        }
        pinnedVerification = freezeVerificationSpecification(specification, contract, pinnedPlan);
      }
      if (pinnedPlan !== undefined) activeApprovedPlan = pinnedPlan;
      let nodeOutput: string | undefined;
      const producedArtifacts: Array<{
        id: string;
        kind: 'execution_plan';
        status: string;
        hash: string;
        valid: boolean;
        current: boolean;
      }> = [];
      if (controller.signal.aborted) throw new Error('Cancelled by operator');
      // Honour a pause before spending anything on the next node.
      await this.waitWhilePaused(task.id, controller.signal);
      executions += 1;
      if (executions > task.maxAttempts * graph.nodes.length) {
        throw new Error(`Exceeded max attempts budget (${task.maxAttempts})`);
      }
      this.assertBudget(task);

      const nodeRunId = randomUUID();
      const invocationId = randomUUID();
      this.db
        .prepare(
          'INSERT INTO node_runs (id, graph_run_id, node_key, state, started_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(nodeRunId, graphRunId, node.id, 'running', now(), now());
      openRuns.set(node.id, { nodeRunId, invocationId });

      const route =
        role === 'planner' || role === 'reviewer' || role === 'writer' || role === 'verifier'
          ? await this.resolveRoute(role, task.id)
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

      this.invocations.create({
        id: invocationId,
        nodeRunId,
        providerConnectionId: route?.providerId ?? 'deterministic',
        configuredModelId: route?.modelId ?? 'command-runner',
        status: 'running',
        startedAt: now(),
      });

      const workflowContext = (node.authorityRole === 'executor' ? [] : completed).flatMap(
        (result) => {
          const resultOutput = result.output as { output?: unknown } | undefined;
          const output =
            typeof resultOutput?.output === 'string' ? resultOutput.output.trim() : undefined;
          if (!output) return [];
          return [
            {
              id: `workflow:${result.nodeId}`,
              content: [
                `Completed graph node: ${result.nodeId} (${result.role})`,
                output.slice(0, 12_000),
              ].join('\n'),
              source: `workflow:${result.nodeId}`,
              sensitivity: 'internal' as const,
              priority: 85,
            },
          ];
        },
      );
      const disclosureEntries = [
        ...(pinnedPlan === undefined
          ? []
          : [
              buildPinnedArtifactContext({
                kind: 'execution_plan',
                id: pinnedPlan.id,
                hash: pinnedPlan.hash,
                content: JSON.stringify(pinnedPlan),
              }),
            ]),
        ...(pinnedVerification === undefined
          ? []
          : [
              buildPinnedArtifactContext({
                kind: 'verification_specification',
                id: pinnedVerification.id,
                hash: pinnedVerification.hash,
                content: JSON.stringify(pinnedVerification),
              }),
            ]),
        ...(role === 'planner' && contract !== undefined
          ? [
              buildPinnedArtifactContext({
                kind: 'change_contract',
                id: contract.id,
                hash: contract.hash,
                content: JSON.stringify(contract),
              }),
            ]
          : []),
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
        ...workflowContext,
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
                "Judge whether the writer's change actually satisfies the brief.",
                'End your reply with exactly one line:',
                '  VERDICT: PASS',
                'or',
                '  VERDICT: NEEDS_CHANGES — <one sentence on what is missing>',
                '',
                compiled.promptBlock,
              ].join('\n')
            : [
                `PLANNER for RoleFlock task "${task.title}" (read-only).`,
                'Do not modify files.',
                node.focus ? `Your independent swarm assignment: ${node.focus}` : '',
                node.authorityRole === 'planner' && contract !== undefined
                  ? plannerStructuredOutputPrompt(contract)
                  : '',
                '',
                compiled.promptBlock,
              ]
                .filter(Boolean)
                .join('\n');

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
          onRoute: (next) => this.updateExecution(task, graphRunId, nodeRunId, role, phase, next),
        });
        const output = invoked.output;
        nodeOutput = output;
        const served = invoked.route;

        if (role === 'planner' && node.authorityRole === 'planner') {
          if (contract === undefined) {
            throw new Error('Assured planner requires the current authorised Change Contract');
          }
          const plan = compilePlannerPlanProposal({
            output,
            planId: randomUUID(),
            version: 1,
            contract,
            proposedBy: {
              invocationId,
              role: 'planner',
              providerId: served.providerId,
              modelId: served.modelId,
            },
          });
          nodeOutput = JSON.stringify(plan);
          this.evidence.addArtefact({
            id: plan.id,
            taskId: task.id,
            kind: 'execution_plan',
            contentRef: nodeOutput,
            metadata: {
              hash: plan.hash,
              status: plan.status,
              contractHash: plan.contractHash,
              version: plan.version,
              nodeRunId,
            },
            createdAt: now(),
          });
          producedArtifacts.push({
            id: plan.id,
            kind: 'execution_plan',
            status: plan.status,
            hash: plan.hash,
            valid: true,
            current: true,
          });
        }

        const provenance = `${node.id} via ${served.providerDisplayName} / ${served.modelDisplayName}${
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
          const invoked = await this.invokeRole({
            role,
            task,
            graphRunId,
            nodeRunId,
            invocationId,
            prompt: `Review the proposed source-code change and confirm whether its repository scope is appropriate.\n\n${compiled.promptBlock}`,
            cwd: worktreePath,
            signal: controller.signal,
          });
          nodeOutput = invoked.output;
          this.evidence.addFinding({
            id: randomUUID(),
            taskId: task.id,
            nodeRunId,
            severity: 'info',
            summary: `reviewer via ${invoked.route.providerDisplayName} / ${invoked.route.modelDisplayName}`,
            details: nodeOutput || 'The reviewer found no additional concerns.',
            createdAt: now(),
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
            paths: ['**'],
            sideEffectClass: 'local_write',
          },
          affectedPaths: ['**'],
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
        } catch (error) {
          memLease.release();
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(`Writer lease unavailable (durable): ${detail}`, { cause: error });
        }
        this.worktrees.setWriterLease(task.id, leaseId);
        try {
          const relativeTarget = 'ROLEFLOCK_SIMULATION.md';
          let writerRoute = route;
          const cursorReady =
            route?.adapter instanceof CursorWriterAdapter &&
            process.env.ROLEFLOCK_CURSOR_AGENT !== '0' &&
            (await route.adapter.hasAgentCli());
          const directWriter =
            !this.forceFake &&
            Boolean(
              route?.adapter.capabilities.writes &&
              (!(route.adapter instanceof CursorWriterAdapter) || cursorReady),
            );
          const patchWriter = !this.forceFake && Boolean(route?.adapter.capabilities.patches);
          let appliedValidatedPatch = false;

          if (!this.forceFake && !directWriter && !patchWriter) {
            const skipped = this.router
              .skippedFor('writer')
              .map((candidate) => candidate.detail ?? candidate.reason)
              .join('; ');
            throw new Error(
              route
                ? `The selected writer (${route.providerDisplayName} / ${route.modelDisplayName}) supports neither direct writes nor validated patches.`
                : `No configured writer can edit the leased worktree${skipped ? `: ${skipped}` : '.'}`,
            );
          }

          const envelope =
            pinnedPlan !== undefined
              ? executorPermissionEnvelope(pinnedPlan, worktreePath)
              : directWriter || patchWriter
                ? {
                    worktree: worktreePath,
                    allowedPaths: ['**'],
                    allowCommands: true,
                  }
                : {
                    worktree: worktreePath,
                    allowedPaths: [relativeTarget],
                    allowCommands: false,
                  };

          if (directWriter || patchWriter) {
            // Build once, but only send it to API-only patch providers. Direct
            // agents inspect the worktree themselves and should not pay the
            // token cost. A route failover can therefore switch modes safely.
            const patchContext = await buildPatchWriterContext(worktreePath, task.brief);
            const prompt = (activeRoute: RoleRoute) =>
              [
                pinnedPlan !== undefined
                  ? executorInstructionBlock(pinnedPlan)
                  : 'Implement the smallest sufficient bug fix in this repository worktree.',
                `Title: ${task.title}`,
                `Brief: ${task.brief}`,
                `Expected: ${task.expectedBehaviour ?? 'n/a'}`,
                `Actual: ${task.actualBehaviour ?? 'n/a'}`,
                '',
                compiled.promptBlock,
                activeRoute.adapter.capabilities.patches && !activeRoute.adapter.capabilities.writes
                  ? [
                      'You cannot call filesystem tools in this turn.',
                      'Return ONLY one git-style unified diff beginning with "diff --git".',
                      'Do not wrap it in commentary. Do not use absolute paths or paths containing "..".',
                      'The diff will be path-validated and checked with `git apply --check` before application.',
                      '',
                      patchContext,
                    ].join('\n')
                  : '',
                'Stay inside this workspace. Prefer editing existing source over adding docs.',
                'Do not invent secrets or reach outside the worktree.',
              ].join('\n');
            const invoked = await this.invokeRole({
              role,
              task,
              graphRunId,
              nodeRunId,
              invocationId,
              prompt,
              cwd: worktreePath,
              signal: controller.signal,
              permissionEnvelope: envelope,
              onRoute: (next) => {
                writerRoute = next;
                this.updateExecution(task, graphRunId, nodeRunId, role, phase, next);
              },
            });
            writerRoute = invoked.route;
            nodeOutput = invoked.output;
            const resolvedPatchWriter =
              invoked.route.adapter.capabilities.patches &&
              !invoked.route.adapter.capabilities.writes;
            if (resolvedPatchWriter) {
              const applied = await applyModelPatch(invoked.output, envelope);
              appliedValidatedPatch = true;
              this.publishLiveProgress(nodeRunId, {
                activity: `Validated and applied ${applied.paths.length} model patch path(s)`,
              });
            }
          } else {
            const content = `# RoleFlock simulation artefact\n\nThis file demonstrates the workflow only. It is not a verified source-code fix.\n\nBrief: ${task.brief}\nExpected: ${task.expectedBehaviour ?? 'n/a'}\nActual: ${task.actualBehaviour ?? 'n/a'}\nMode: simulation\n`;
            await writeFile(join(worktreePath, relativeTarget), content);
          }

          const diff = await captureDiff(worktreePath);
          assertChangedPathsAllowed(envelope, diff.changedFiles);
          if (pinnedPlan !== undefined) {
            assertExecutorChangedPaths(pinnedPlan, diff.changedFiles);
          }
          if (!diff.changedFiles.length) {
            throw new Error('Writer completed without changing any files in the leased worktree.');
          }
          this.publishLiveProgress(nodeRunId, {
            activity: `Wrote ${diff.changedFiles.length} file(s) · +${diff.added}/−${diff.removed}`,
            liveDiff: {
              patch: diff.patch.slice(0, 48_000),
              status: diff.status,
              changedFiles: diff.changedFiles,
              added: diff.added,
              removed: diff.removed,
            },
          });
          this.evidence.addArtefact({
            id: randomUUID(),
            taskId: task.id,
            kind: 'diff',
            path: directWriter || patchWriter ? worktreePath : join(worktreePath, relativeTarget),
            contentRef: diff.patch,
            metadata: {
              changedFiles: diff.changedFiles,
              status: diff.status,
              added: diff.added,
              removed: diff.removed,
              providerId: writerRoute?.providerId,
              permissionEnvelope: envelope,
              durableLeaseId: leaseId,
              writerMode: appliedValidatedPatch
                ? `${writerRoute?.providerId ?? 'model'}-validated-patch`
                : directWriter || writerRoute?.adapter.capabilities.writes
                  ? `${writerRoute?.providerId ?? 'agent'}-agent`
                  : 'simulation',
            },
            createdAt: now(),
          });
        } finally {
          this.leases.release(leaseId, now());
          memLease.release();
          this.worktrees.setWriterLease(task.id, null);
        }
      } else if (role === 'test') {
        // Assurance path: when the task carries authorised intent, an approved
        // plan, and a frozen specification, the verdict comes from a clean
        // runner reading a sealed commit — never from this worktree, which the
        // writer still owns.
        const assured = await this.runAssuredVerification({
          task,
          graphRunId,
          nodeRunId,
          worktreePath,
          baseCommit,
        });
        if (assured) {
          nodeOutput = JSON.stringify({
            resultCommit: assured.sealed.resultCommit,
            decisionHash: assured.decision.hash,
            outcome: assured.decision.overallOutcome,
          });
          if (!assured.passed) {
            const failing = assured.decision.verdicts.filter(
              (verdict) => verdict.outcome !== 'pass',
            );
            throw new NodeFailure(
              `Independent verification did not pass: ${failing
                .map((verdict) => `${verdict.criterionId} (${verdict.outcome})`)
                .join(', ')}`,
              'verification_failed',
              {
                repairClass: classifyMechanicalFailure(
                  assured.decision.findings.map((finding) => finding.summary).join('\n'),
                ),
              },
            );
          }
        } else if (graph.requiresAssurance) {
          // Fail closed. Every other mode drops to the writer's own worktree
          // check here, which is exactly the substitution an assured run must
          // never make: the check would pass, the task would reach acceptance,
          // and nothing downstream would record that no independent verdict was
          // ever produced.
          throw new NodeFailure(
            `Assured mode cannot verify this task without ${this.missingAssuranceInputs(task.id).join(', ')}. Supply it and resume, or run this task in a mode that does not claim assurance.`,
            'verification_failed',
          );
        } else {
          const verification = await this.resolveVerification(task, worktreePath);
          this.publishLiveProgress(nodeRunId, {
            activity: `Running ${verification.label}`,
            append: `$ ${verification.command}${verification.args.length ? ` ${verification.args.join(' ')}` : ''}\n`,
          });
          // A non-zero exit is a verification result, not an orchestration error:
          // it must still be recorded as evidence before the node fails.
          const { passed, exitCode, stdout, stderr, timedOut } = await runCommand({
            command: verification.command,
            args: verification.args,
            cwd: worktreePath,
            sandboxRoot: worktreePath,
            timeoutMs: verificationTimeoutMs(),
            onChunk: (stream, chunk) => {
              this.publishLiveProgress(nodeRunId, {
                append: stream === 'stderr' ? chunk : chunk,
              });
            },
          }).then(
            (result) => ({
              passed: true,
              exitCode: result.exitCode ?? 0,
              stdout: result.stdout,
              stderr: result.stderr,
              timedOut: false,
            }),
            (error: unknown) => {
              if (!(error instanceof CommandError)) throw error;
              return {
                passed: false,
                exitCode: error.result.exitCode ?? undefined,
                stdout: error.result.stdout,
                stderr: error.result.stderr,
                timedOut: error.result.timedOut,
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
              `${
                timedOut
                  ? `Verification timed out after ${verificationTimeoutMs()} ms`
                  : 'Verification failed'
              } (${verification.label})${stderr ? `: ${stderr.slice(0, 400)}` : ''}`,
              'verification_failed',
              {
                repairClass: classifyMechanicalFailure(`${verification.label}\n${stderr ?? ''}`),
              },
            );
          }
        }
      } else if (role === 'accept') {
        this.setTaskState(task.id, 'awaiting_acceptance');
        this.updateExecution(task, graphRunId, nodeRunId, role, 'awaiting_confirmation');
        // `resolveAcceptance` issues the passport, so it is already durable by
        // the time this node resumes.
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
      openRuns.delete(node.id);
      return {
        role,
        nodeRunId,
        output: nodeOutput,
        ...(producedArtifacts.length === 0 ? {} : { artifacts: producedArtifacts }),
      };
    };

    const { results } = await runGraph(
      graph,
      async (context) => {
        try {
          return await executeNode(context);
        } catch (error) {
          this.closeFailedNodeRun(openRuns.get(context.node.id), error, controller.signal.aborted);
          throw error;
        }
      },
      {
        signal: controller.signal,
        resumeCompleted,
        initialArtifacts: (() => {
          const current = this.currentContract(task.id);
          return current === undefined
            ? []
            : [
                {
                  id: current.id,
                  kind: 'change_contract' as const,
                  status: current.status,
                  hash: current.hash,
                  valid: true,
                  current: true,
                },
              ];
        })(),
        evaluateEdgeGuard: ({ edge, error, loopIteration }) => {
          if (edge.guard !== 'repair_envelope') return false;
          const repairClass = error instanceof NodeFailure ? error.repairClass : undefined;
          if (activeApprovedPlan === undefined || repairClass === undefined) return false;
          const decision = evaluateRepairEnvelope(activeApprovedPlan, {
            failureClass: repairClass as Parameters<
              typeof evaluateRepairEnvelope
            >[1]['failureClass'],
            changedPaths: activeApprovedPlan.expectedChangedPaths,
            requiredOperations: ['modify_file', 'run_command'],
            attempt: loopIteration + 1,
            deterministic: true,
            addsFiles: false,
            changesDependencies: false,
            changesPublicApi: false,
            changesSchema: false,
            requiresArchitectureDecision: false,
            expandsScope: false,
            changesRequirement: false,
            planStillSufficient: true,
            contractStillSufficient: this.currentContract(task.id) !== undefined,
            retryBudgetRemaining: loopIteration + 1 <= task.maxAttempts,
            costBudgetRemaining: true,
            timeBudgetRemaining: true,
          });
          this.appendEvent(task.id, 'repair.envelope.evaluated', {
            graphRunId,
            edge,
            decision: decision.decision,
            reasons: decision.reasons,
            planHash: decision.planHash,
          });
          return decision.allowed;
        },
        onNodeState: (nodeId, state, attempt) => {
          this.appendEvent(task.id, 'node.state', { graphRunId, nodeId, state, attempt });
          this.bus.publish('graph.node.updated', { taskId: task.id, graphRunId, nodeId, state });
        },
      },
    );

    const failed = results.find((r) => r.status === 'failed');
    const blocked = failed?.error instanceof ProviderUnavailableError ? failed.error : undefined;
    const setupRequired =
      failed?.error instanceof NodeFailure && failed.error.failureClass === 'setup_required';

    if (blocked || setupRequired) {
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
          blocked?.role ?? null,
          setupRequired ? 'setup_required' : (blocked?.refusals[0]?.reason ?? 'unavailable'),
          JSON.stringify(blocked?.refusals ?? []),
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
        openRuns.get(failed.nodeId)?.nodeRunId,
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

  private recordFailure(
    taskId: string,
    summary: string,
    details: string,
    nodeRunId?: string,
  ): void {
    this.evidence.addFinding({
      id: randomUUID(),
      taskId,
      nodeRunId,
      severity: 'error',
      summary,
      details,
      createdAt: now(),
    });
    this.bus.publish('task.failed', { taskId, error: details });
  }

  /**
   * Closes the rows a failed node left open.
   *
   * Only the success path used to write a terminal state, so a failed node kept
   * a `running` node run and a `running` invocation on record for good. Both are
   * what the run graph and the process reconciler read, so leaving them meant
   * the failure was invisible everywhere except the task's own state.
   */
  private closeFailedNodeRun(
    open: { nodeRunId: string; invocationId: string } | undefined,
    error: unknown,
    cancelled: boolean,
  ): void {
    if (!open) return;
    const message = error instanceof Error ? error.message : String(error);
    const state = cancelled ? 'cancelled' : 'failed';
    const at = now();
    this.invocations.updateStatus(
      open.invocationId,
      state,
      cancelled ? 'cancelled' : 'error',
      at,
      JSON.stringify({ message: message.slice(0, 2_000) }),
    );
    this.db
      .prepare('UPDATE node_runs SET state = ?, completed_at = ?, outcome = ? WHERE id = ?')
      .run(state, at, message.slice(0, 400), open.nodeRunId);
    this.closeProcessHandles(open.nodeRunId, 'unknown');
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

  private async resolveRoute(role: RoutedRole, taskId: string): Promise<RoleRoute | null> {
    return this.router.route(role, { forceFake: this.forceFake, taskId });
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
    prompt: string | ((route: RoleRoute) => string);
    cwd: string;
    signal: AbortSignal;
    permissionEnvelope?: { worktree: string; allowedPaths: string[]; allowCommands?: boolean };
    onRoute?: (route: RoleRoute) => void;
  }): Promise<{ output: string; route: RoleRoute; usage?: ReportedUsage }> {
    const attempted = new Set<string>();
    const refusals: ProviderRefusal[] = [];

    for (;;) {
      const route = await this.resolveRoute(input.role, input.task.id);
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
          prompt: typeof input.prompt === 'function' ? input.prompt(route) : input.prompt,
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
        // A turn that went quiet is not a refusal. Parking the candidate would
        // walk the role down its fallback list over one slow reply, and end on
        // "no provider available" when every provider was in fact healthy.
        if (error instanceof ProviderIdleTimeoutError) throw error;

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

  private providerIdleTimeoutMs(): number {
    return providerIdleTimeoutMs();
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
    let reasoningChars = 0;
    let usage: ReportedUsage | undefined;
    const watchdog = createIdleWatchdog(input.signal, this.providerIdleTimeoutMs());
    // Cap what the live projection stores. The evidence finding still gets the
    // full text; this is only so the task page stays readable while streaming.
    const liveCap = 24_000;
    let lastPublish = 0;
    let lastReasoningPublish = 0;
    let lastDiffAt = 0;
    const worktree = input.permissionEnvelope?.worktree;

    const flushLive = async (force = false): Promise<void> => {
      const at = Date.now();
      if (!force && at - lastPublish < 250) return;
      lastPublish = at;
      let liveDiff: ActiveExecution['liveDiff'];
      if (worktree && (force || at - lastDiffAt > 1_500)) {
        lastDiffAt = at;
        try {
          const diff = await captureDiff(worktree);
          liveDiff = {
            patch: diff.patch.slice(0, 48_000),
            status: diff.status,
            changedFiles: diff.changedFiles,
            added: diff.added,
            removed: diff.removed,
          };
        } catch {
          // A worktree that is mid-write can briefly refuse git; skip this tick.
        }
      }
      this.publishLiveProgress(input.nodeRunId, {
        output: output.length > liveCap ? `…\n${output.slice(-liveCap)}` : output,
        liveDiff,
        activity: worktree
          ? liveDiff && liveDiff.changedFiles.length
            ? `Writing · ${liveDiff.changedFiles.length} file(s) · +${liveDiff.added}/−${liveDiff.removed}`
            : 'Writing…'
          : undefined,
      });
    };
    const flushReasoning = (force = false): void => {
      const at = Date.now();
      if (!force && at - lastReasoningPublish < 250) return;
      lastReasoningPublish = at;
      this.publishLiveProgress(input.nodeRunId, {
        reasoningChars,
        activity: output
          ? undefined
          : `Reasoning stream active · ${reasoningChars.toLocaleString()} chars received`,
      });
    };

    try {
      for await (const event of input.adapter.invoke({
        invocationId: input.invocationId,
        prompt: input.prompt,
        cwd: input.cwd,
        signal: watchdog.signal,
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
        // Any event is proof of life. The turn is only abandoned when the
        // provider goes quiet, never for taking its time.
        watchdog.touch();
        if (event.type === 'heartbeat') {
          const execution = this.executions.getByNodeRun(input.nodeRunId);
          if (execution) {
            execution.lastHeartbeatAt = event.at;
            this.executions.upsert(execution);
            this.bus.publish('execution.updated', execution);
          }
        }
        if (event.type === 'model.output.delta') {
          output += event.text;
          await flushLive();
        }
        if (event.type === 'model.reasoning.delta') {
          reasoningChars += event.text.length;
          flushReasoning();
        }
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
      if (reasoningChars) flushReasoning(true);
      await flushLive(true);
    } catch (error) {
      this.closeProcessHandles(input.nodeRunId, 'unknown');
      // Operator first: only a Stop makes the parent signal fire, and that is
      // the one abort a retry must not paper over.
      if (input.signal.aborted) throw new Error('Cancelled by operator', { cause: error });
      if (watchdog.expired() || (error instanceof Error && error.name === 'AbortError')) {
        throw new ProviderIdleTimeoutError(this.providerIdleTimeoutMs(), { cause: error });
      }
      throw error;
    } finally {
      watchdog.dispose();
    }
    this.closeProcessHandles(input.nodeRunId, 'terminated');
    return { output, usage };
  }

  /**
   * Pushes live turn text (and optionally a worktree diff) onto the active
   * execution projection so the task page can stream what is happening.
   */
  private publishLiveProgress(
    nodeRunId: string,
    update: {
      output?: string;
      append?: string;
      liveDiff?: ActiveExecution['liveDiff'];
      activity?: string;
      reasoningChars?: number;
    },
  ): void {
    const execution = this.executions.getByNodeRun(nodeRunId);
    if (!execution) return;
    if (update.output !== undefined) execution.liveOutput = update.output;
    if (update.append) {
      const next = `${execution.liveOutput ?? ''}${update.append}`;
      execution.liveOutput = next.length > 24_000 ? `…\n${next.slice(-24_000)}` : next;
    }
    if (update.liveDiff) execution.liveDiff = update.liveDiff;
    if (update.reasoningChars !== undefined) execution.reasoningChars = update.reasoningChars;
    if (update.activity) execution.currentActivity = update.activity;
    execution.lastHeartbeatAt = now();
    this.executions.upsert(execution);
    this.bus.publish('execution.updated', execution);
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
        args: ['-e', 'console.log("Simulation check passed — this is not a real repository test")'],
        label: 'simulation-check',
      };
    }
    if (task.verificationCommand?.trim()) {
      const parts = parseCommandArgv(task.verificationCommand);
      const command = parts[0];
      return {
        command,
        args: parts.slice(1),
        label: task.verificationCommand.trim(),
      };
    }
    const suggested = await discoverVerificationCommand(worktreePath);
    if (suggested) {
      const parts = parseCommandArgv(suggested);
      return { command: parts[0], args: parts.slice(1), label: suggested };
    }
    throw new NodeFailure(
      'Verification command required: no configured command or supported test convention was found. Add one before retrying.',
      'setup_required',
    );
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
      // A new node starts a fresh transcript; leaving the previous turn's text
      // made the live panel look like the old role was still speaking.
      liveOutput: '',
      liveDiff: undefined,
      startedAt: timestamp,
      lastHeartbeatAt: timestamp,
      attempt: 1,
      maxAttempts: task.maxAttempts,
      actualCost: costs.actualCostUsd,
      shadowCost: costs.shadowCostUsd,
      inputTokens: costs.inputTokens,
      outputTokens: costs.outputTokens,
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
  const matches = [
    ...(output ?? '').matchAll(
      /VERDICT:\s*(PASS|NEEDS[_\s]CHANGES)\b[^\S\n]*(?:[—–:-]\s*)?([^\n]*)/gi,
    ),
  ];
  const last = matches.at(-1);
  if (!last) return { decision: 'inconclusive' };

  const decision = /needs/i.test(last[1] ?? '') ? 'needs_changes' : 'pass';
  const reason = last[2]?.trim();
  return { decision, reason: reason || undefined };
}

/**
 * Derived rather than listed. A hand-maintained copy of the mode names drifts
 * the moment a mode is added, and the cost of that drift is silent: the stored
 * pin stops being recognised and the task runs a different graph than the one
 * it was created with.
 */
const GRAPH_MODES: readonly GraphMode[] = Object.keys(workflowGraphs) as GraphMode[];

/**
 * Pins a task to the graph version it was created with. Tasks written before
 * graph versioning stored a bare mode (`bug_fix`); those still resolve, but new
 * runs are recorded against an explicit `mode@version`.
 *
 * The legacy default only applies to a task that never recorded a mode. A task
 * that names a mode this build does not have is an error, not something to
 * substitute a graph for: quietly running `bug_fix` in place of a mode that
 * required assurance would drop the guarantee the task was created under.
 */
export function resolveTaskGraph(task: Task): WorkflowGraph {
  const stored = task.workflowGraphVersionId ?? '';
  const [mode] = stored.split('@');
  if (GRAPH_MODES.includes(mode as GraphMode)) return getWorkflowGraph(stored);
  if (stored !== '') {
    throw new Error(
      `Task ${task.id} is pinned to workflow graph "${stored}", which this build does not provide.`,
    );
  }
  return getWorkflowGraph(graphVersionId(task.type === 'bug_fix' ? 'bug_fix' : 'standard'));
}
