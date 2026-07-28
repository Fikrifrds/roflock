import {
  isFailureCondition,
  validateGraph,
  type EdgeCondition,
  type GraphNode,
  type WorkflowGraph,
} from '@roleflock/graph-core';
import {
  RoleProtocolViolation,
  assertRoleCompletion,
  assertRoleStart,
  type PresentedArtifact,
} from '@roleflock/role-protocol';

export type NodeState = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/**
 * Why a node failed, which decides where the run goes next. Classification is
 * explicit when the caller throws a {@link NodeFailure} and heuristic otherwise,
 * so an unrecognised error never silently looks like a clean verification fail.
 */
export type FailureClass =
  | 'verification_failed'
  | 'needs_changes'
  | 'timeout'
  | 'provider_error'
  | 'budget_exhausted'
  | 'setup_required'
  | 'cancelled'
  | 'unknown';

export class NodeFailure extends Error {
  readonly repairClass?: string;

  constructor(
    message: string,
    readonly failureClass: FailureClass,
    options?: { cause?: unknown; repairClass?: string },
  ) {
    super(message, options);
    this.name = 'NodeFailure';
    this.repairClass = options?.repairClass;
  }
}

export interface NodeResult {
  nodeId: string;
  role: string;
  status: Exclude<NodeState, 'pending' | 'running'>;
  output?: unknown;
  error?: unknown;
  failureClass?: FailureClass;
  attempt: number;
}

export interface NodeContext {
  node: GraphNode;
  attempt: number;
  loopIteration: number;
  completed: readonly NodeResult[];
}

export interface GraphRunResult {
  results: NodeResult[];
  state: 'completed' | 'failed';
  loopIterations: number;
}

export interface RunGraphOptions {
  /** Node ids already completed before this run — used to resume after a restart. */
  resumeCompleted?: readonly string[];
  /** Observability hook; fires on every node state transition. */
  onNodeState?: (nodeId: string, state: NodeState, attempt: number) => void;
  signal?: AbortSignal;
  /** Current, verified artifacts available before this graph run begins. */
  initialArtifacts?: readonly PresentedArtifact[];
  /**
   * Extracts newly produced artifacts from a successful node result. The
   * default recognises `{ artifacts: PresentedArtifact[] }`.
   */
  artifactExtractor?: (output: unknown) => readonly PresentedArtifact[];
  /** Evaluates typed edge guards; absent evaluators fail closed. */
  evaluateEdgeGuard?: (input: {
    edge: WorkflowGraph['edges'][number];
    node: GraphNode;
    error: unknown;
    failureClass: FailureClass;
    attempt: number;
    loopIteration: number;
  }) => boolean;
}

export class ArtifactGateError extends Error {
  constructor(
    readonly nodeId: string,
    readonly phase: 'start' | 'completion',
    readonly violation: RoleProtocolViolation,
  ) {
    super(`Artifact gate rejected ${nodeId} at ${phase}: ${violation.message}`, {
      cause: violation,
    });
    this.name = 'ArtifactGateError';
  }
}

function defaultArtifactExtractor(output: unknown): readonly PresentedArtifact[] {
  if (typeof output !== 'object' || output === null || !('artifacts' in output)) return [];
  const artifacts = (output as { artifacts?: unknown }).artifacts;
  if (!Array.isArray(artifacts)) return [];
  return artifacts.filter(
    (candidate): candidate is PresentedArtifact =>
      typeof candidate === 'object' &&
      candidate !== null &&
      typeof (candidate as PresentedArtifact).id === 'string' &&
      typeof (candidate as PresentedArtifact).kind === 'string',
  );
}

export function classifyFailure(error: unknown): FailureClass {
  if (error instanceof NodeFailure) return error.failureClass;
  if (!(error instanceof Error)) return 'unknown';
  if (error.name === 'AbortError') return 'cancelled';
  const text = `${error.name}: ${error.message}`.toLowerCase();
  if (/cancelled|aborted/.test(text)) return 'cancelled';
  if (/timed out|timeout/.test(text)) return 'timeout';
  if (/budget|quota/.test(text)) return 'budget_exhausted';
  if (/verification failed/.test(text)) return 'verification_failed';
  if (/provider|invocation failed|cli/.test(text)) return 'provider_error';
  return 'unknown';
}

/**
 * Preference order per failure class. `on_fail` is the catch-all, so a graph
 * that only declares `on_fail` still routes a timeout or a provider error.
 */
const ROUTES: Record<FailureClass, EdgeCondition[]> = {
  verification_failed: ['on_fail'],
  needs_changes: ['on_needs_changes', 'on_fail'],
  timeout: ['on_timeout', 'on_fail'],
  provider_error: ['on_provider_error', 'on_fail'],
  budget_exhausted: ['on_budget_exhausted'],
  // Missing operator configuration is not an implementation failure. Stop at
  // the gate so retry can resume there instead of sending unchanged code back
  // through the writer.
  setup_required: [],
  cancelled: [],
  unknown: ['on_fail'],
};

function descendantsOf(graph: WorkflowGraph, start: string): Set<string> {
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const candidate of graph.nodes) {
      if (candidate.dependsOn.includes(id)) walk(candidate.id);
    }
  };
  walk(start);
  return seen;
}

/**
 * Executes a validated graph.
 *
 * Scheduling is dependency-ordered with a concurrency cap, and writers are
 * serialised on top of that cap so two nodes can never mutate one worktree at
 * the same time. A failed node first spends its local retry budget, then follows
 * a typed failure edge if one matches; taking that edge resets the target and
 * everything downstream, so a re-run is honest rather than partially stale. The
 * number of such re-entries is capped by `graph.maxLoopIterations`.
 */
export async function runGraph(
  graph: WorkflowGraph,
  execute: (context: NodeContext) => Promise<unknown>,
  options: RunGraphOptions = {},
): Promise<GraphRunResult> {
  const errors = validateGraph(graph);
  if (errors.length) throw new Error(`Invalid graph: ${errors.join(', ')}`);

  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const state = new Map<string, NodeState>(graph.nodes.map((node) => [node.id, 'pending']));
  const attempts = new Map<string, number>(graph.nodes.map((node) => [node.id, 0]));
  const results: NodeResult[] = [];
  const artifacts: PresentedArtifact[] = [...(options.initialArtifacts ?? [])];
  const extractArtifacts = options.artifactExtractor ?? defaultArtifactExtractor;
  let loopIterations = 0;
  let runFailed = false;

  const setState = (id: string, next: NodeState) => {
    state.set(id, next);
    options.onNodeState?.(id, next, attempts.get(id) ?? 0);
  };

  const recordResult = (result: NodeResult) => {
    const existing = results.findIndex((candidate) => candidate.nodeId === result.nodeId);
    if (existing >= 0) results.splice(existing, 1);
    results.push(result);
  };

  for (const id of options.resumeCompleted ?? []) {
    const node = byId.get(id);
    if (!node) continue;
    state.set(id, 'completed');
    recordResult({ nodeId: id, role: node.role, status: 'completed', attempt: 0 });
  }

  const isReady = (node: GraphNode) =>
    state.get(node.id) === 'pending' &&
    node.dependsOn.every((dependency) => state.get(dependency) === 'completed');

  const running = new Map<string, Promise<{ nodeId: string; error?: unknown; output?: unknown }>>();

  while (!runFailed) {
    if (options.signal?.aborted) {
      for (const [id, value] of state) if (value === 'pending') setState(id, 'skipped');
      runFailed = true;
      break;
    }

    for (const node of graph.nodes) {
      if (running.size >= graph.maxConcurrency) break;
      if (!isReady(node)) continue;
      // One writer per worktree, independent of the concurrency budget.
      if (node.writer && [...running.keys()].some((id) => byId.get(id)?.writer)) continue;
      if (node.authorityRole !== undefined) {
        try {
          assertRoleStart(node.authorityRole, artifacts);
        } catch (error) {
          if (error instanceof RoleProtocolViolation) {
            throw new ArtifactGateError(node.id, 'start', error);
          }
          throw error;
        }
      }

      const attempt = (attempts.get(node.id) ?? 0) + 1;
      attempts.set(node.id, attempt);
      setState(node.id, 'running');
      const iteration = loopIterations;
      running.set(
        node.id,
        execute({ node, attempt, loopIteration: iteration, completed: results }).then(
          (output) => ({ nodeId: node.id, output }),
          (error: unknown) => ({ nodeId: node.id, error: error ?? new Error('unknown failure') }),
        ),
      );
    }

    if (running.size === 0) {
      // Nothing runnable left; anything still pending is unreachable.
      const stranded = [...state.entries()].filter(([, value]) => value === 'pending');
      for (const [id] of stranded) {
        setState(id, 'skipped');
        recordResult({
          nodeId: id,
          role: byId.get(id)!.role,
          status: 'skipped',
          error: 'dependency did not complete',
          attempt: attempts.get(id) ?? 0,
        });
      }
      if (stranded.length) runFailed = true;
      break;
    }

    const settled = await Promise.race(running.values());
    running.delete(settled.nodeId);
    const node = byId.get(settled.nodeId)!;
    const attempt = attempts.get(node.id) ?? 1;

    if (settled.error === undefined) {
      const nodeArtifacts = extractArtifacts(settled.output);
      if (node.authorityRole !== undefined) {
        try {
          assertRoleCompletion(node.authorityRole, nodeArtifacts);
        } catch (error) {
          settled.error =
            error instanceof RoleProtocolViolation
              ? new ArtifactGateError(node.id, 'completion', error)
              : error;
        }
      }
      if (settled.error === undefined) artifacts.push(...nodeArtifacts);
    }

    if (settled.error === undefined) {
      setState(node.id, 'completed');
      recordResult({
        nodeId: node.id,
        role: node.role,
        status: 'completed',
        output: settled.output,
        attempt,
      });
      continue;
    }

    const failureClass = classifyFailure(settled.error);

    // 1. Local retry budget.
    if (failureClass !== 'cancelled' && attempt < (node.maxAttempts ?? 1)) {
      setState(node.id, 'pending');
      continue;
    }

    // 2. Typed failure edge.
    const edge = ROUTES[failureClass]
      .flatMap((condition) =>
        graph.edges.filter(
          (candidate) =>
            candidate.from === node.id &&
            candidate.when === condition &&
            isFailureCondition(candidate.when),
        ),
      )
      .find(
        (candidate) =>
          candidate.guard === undefined ||
          options.evaluateEdgeGuard?.({
            edge: candidate,
            node,
            error: settled.error,
            failureClass,
            attempt,
            loopIteration: loopIterations,
          }) === true,
      );

    if (edge && loopIterations < graph.maxLoopIterations) {
      loopIterations += 1;
      // Re-running the target invalidates everything downstream of it, including
      // the node that just failed.
      for (const id of descendantsOf(graph, edge.to)) {
        attempts.set(id, 0);
        setState(id, 'pending');
        const index = results.findIndex((candidate) => candidate.nodeId === id);
        if (index >= 0) results.splice(index, 1);
      }
      continue;
    }

    // 3. Out of routes.
    setState(node.id, 'failed');
    recordResult({
      nodeId: node.id,
      role: node.role,
      status: 'failed',
      error: settled.error,
      failureClass,
      attempt,
    });
    runFailed = true;

    // Let in-flight siblings settle so nothing is orphaned mid-write. Preserve
    // what actually happened: a successful parallel planner remains completed
    // even when its sibling fails.
    const siblings = await Promise.all(running.values());
    running.clear();
    for (const sibling of siblings) {
      const siblingNode = byId.get(sibling.nodeId)!;
      const siblingAttempt = attempts.get(sibling.nodeId) ?? 1;
      if (sibling.error === undefined) {
        setState(sibling.nodeId, 'completed');
        recordResult({
          nodeId: sibling.nodeId,
          role: siblingNode.role,
          status: 'completed',
          output: sibling.output,
          attempt: siblingAttempt,
        });
      } else {
        setState(sibling.nodeId, 'failed');
        recordResult({
          nodeId: sibling.nodeId,
          role: siblingNode.role,
          status: 'failed',
          error: sibling.error,
          failureClass: classifyFailure(sibling.error),
          attempt: siblingAttempt,
        });
      }
    }
    for (const [id, value] of state) {
      if (value === 'pending') {
        setState(id, 'skipped');
        recordResult({
          nodeId: id,
          role: byId.get(id)!.role,
          status: 'skipped',
          error: `blocked by ${node.id}`,
          attempt: attempts.get(id) ?? 0,
        });
      }
    }
  }

  const order = new Map(graph.nodes.map((node, index) => [node.id, index]));
  results.sort((a, b) => (order.get(a.nodeId) ?? 0) - (order.get(b.nodeId) ?? 0));

  return {
    results,
    state:
      runFailed || results.some((result) => result.status !== 'completed') ? 'failed' : 'completed',
    loopIterations,
  };
}

/**
 * @deprecated Use {@link runGraph}. Retained for callers that only need
 * dependency-ordered execution with bounded retries.
 */
export async function runSequentialGraph(
  graph: WorkflowGraph,
  execute: (nodeId: string, completed: readonly NodeResult[], attempt: number) => Promise<unknown>,
  options: { maxNodeAttempts?: number } = {},
): Promise<NodeResult[]> {
  const bounded: WorkflowGraph = options.maxNodeAttempts
    ? {
        ...graph,
        nodes: graph.nodes.map((node) => ({
          ...node,
          maxAttempts: node.maxAttempts ?? options.maxNodeAttempts,
        })),
      }
    : graph;
  const { results } = await runGraph(bounded, ({ node, attempt, completed }) =>
    execute(node.id, completed, attempt),
  );
  return results;
}
