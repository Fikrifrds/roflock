import {
  DiagnosticCode,
  type Diagnostic,
  type GraphIR,
  type GraphNode as IrNode,
  type LoopGroup,
} from '@roleflock/graph-ir';
import { ROLE_IDS, type RoleId } from '@roleflock/role-protocol';
import {
  GRAPH_SCHEMA_VERSION,
  validateGraph,
  type EdgeCondition,
  type GraphEdge,
  type GraphNode,
  type NodeKind,
  type WorkflowGraph,
  type WorkflowRole,
} from './index.js';

/**
 * Graph IR → the existing runtime graph.
 *
 * This is a compatibility layer, not a second runtime. Compiled IR is lowered
 * into the `WorkflowGraph` that `runGraph` already executes, so a `.roflock`
 * workflow gets exactly the scheduling, writer serialisation, retry routing and
 * artifact gating that the current engine has been running in production —
 * rather than a parallel implementation that has to re-earn that trust.
 *
 * The bridge fails closed. Anything it cannot represent faithfully produces a
 * diagnostic and no graph, because a workflow that quietly loses a required
 * check or a writer lease is worse than one that refuses to start.
 */

export interface BridgeResult {
  graph?: WorkflowGraph;
  diagnostics: Diagnostic[];
}

function error(code: DiagnosticCode, message: string): Diagnostic {
  return { code, severity: 'error', message };
}

/**
 * Outcomes that continue the happy path. Everything else is either a typed
 * failure that needs an edge, or a terminal the runtime never routes out of.
 */
const SUCCESS_OUTCOMES = new Set(['completed', 'pass', 'human_approved']);

/**
 * IR outcome → the legacy typed failure edge that carries it.
 *
 * `blocked` folds into `on_fail` because the legacy enum has no equivalent;
 * that is a widening, not a loss, since `on_fail` is already the catch-all the
 * runtime falls back to. `human_rejected` is absent on purpose: a rejection is
 * terminal, and inventing a route out of it would let a workflow continue past
 * a human's refusal.
 */
const FAILURE_CONDITIONS: Record<string, EdgeCondition> = {
  fail: 'on_fail',
  changes: 'on_needs_changes',
  timeout: 'on_timeout',
  provider_unavailable: 'on_provider_error',
  budget_exceeded: 'on_budget_exhausted',
  blocked: 'on_fail',
};

const LEGACY_ROLE_IDS = new Set<string>(ROLE_IDS);

/** Namespaced annotation carrying a node's own retry budget. See the compiler. */
const RETRY_BUDGET_ANNOTATION = 'roflock.coding/retry-budget';

/**
 * The Role Protocol role this node answers to, if its role declares one.
 *
 * Undefined leaves the node ungated, exactly as legacy v1 and v2 graphs are.
 * A profile that names no known role is ignored rather than guessed at.
 */
function authorityProfile(node: IrNode, ir: GraphIR): RoleId | undefined {
  const role = ir.roles.find((candidate) => candidate.id === node.roleRef);
  const profile = role?.permissionProfileRef;
  return profile !== undefined && LEGACY_ROLE_IDS.has(profile) ? (profile as RoleId) : undefined;
}

function objectiveOf(node: IrNode): string | undefined {
  if (node.kind === 'agent') return node.agent.objective;
  if (node.kind === 'model_call') return node.modelCall.objective;
  return undefined;
}

/**
 * Nodes that share both a role and a dependency set with another node, and so
 * can be scheduled side by side doing the same job.
 */
function parallelSiblings(ir: GraphIR, dependsOn: Map<string, string[]>): Set<string> {
  const groups = new Map<string, string[]>();
  for (const node of ir.nodes) {
    const key = `${node.roleRef ?? ''}::${[...(dependsOn.get(node.id) ?? [])].sort().join('|')}`;
    groups.set(key, [...(groups.get(key) ?? []), node.id]);
  }
  return new Set([...groups.values()].filter((members) => members.length > 1).flat());
}

function retryBudget(node: IrNode): number | undefined {
  const raw = node.annotations?.[RETRY_BUDGET_ANNOTATION];
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : undefined;
}

function writes(node: IrNode, ir: GraphIR): boolean {
  if (node.effects?.some((effect) => effect.class === 'workspace_write')) return true;
  const role = ir.roles.find((candidate) => candidate.id === node.roleRef);
  return role?.accessMode === 'write';
}

/**
 * The legacy dispatch key, derived rather than declared.
 *
 * `WorkflowRole` is what the orchestrator switches on to decide whether a node
 * gets a provider route, runs the verification runner, or waits for a human, so
 * it has to be right. Every case below is decided by a fact the IR already
 * carries — never by node name or position guesswork.
 */
function dispatchRole(
  node: IrNode,
  ir: GraphIR,
  downstreamOfCheck: Set<string>,
): WorkflowRole | undefined {
  switch (node.kind) {
    case 'check':
      return 'test';
    case 'human':
      // A human node that can end the run in an accepted state is the accept
      // gate; one in the middle of a flow is a reviewer.
      return node.outcomes.some((outcome) => outcome.terminal && outcome.accepted)
        ? 'accept'
        : 'reviewer';
    case 'agent':
    case 'model_call':
      if (writes(node, ir)) return 'writer';
      // A read-only agent that runs after a deterministic check is judging that
      // check's result, which is what the legacy verifier role means.
      return downstreamOfCheck.has(node.id) ? 'verifier' : 'planner';
    default:
      return undefined;
  }
}

const KINDS: Partial<Record<IrNode['kind'], NodeKind>> = {
  agent: 'agent',
  model_call: 'model_call',
  check: 'test',
  action: 'command',
  human: 'human_approval',
  context: 'context_compile',
  evidence: 'evidence_aggregate',
  join: 'join',
  route: 'router',
};

/** Nodes reachable from any check by following success edges. */
function nodesAfterChecks(ir: GraphIR): Set<string> {
  const successors = new Map<string, string[]>();
  for (const edge of ir.edges) {
    if (!SUCCESS_OUTCOMES.has(edge.from.outcome)) continue;
    successors.set(edge.from.nodeId, [...(successors.get(edge.from.nodeId) ?? []), edge.to.nodeId]);
  }
  const seen = new Set<string>();
  const queue = ir.nodes
    .filter((node) => node.kind === 'check')
    .flatMap((node) => successors.get(node.id) ?? []);
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of successors.get(id) ?? []) queue.push(next);
  }
  return seen;
}

/**
 * The widest set of nodes sharing an identical dependency set.
 *
 * Legacy `maxConcurrency` caps how many nodes run at once. Deriving it from the
 * graph's own shape means a workflow with two parallel reviewers actually runs
 * them in parallel, while a linear one is not given a budget it cannot use.
 * Writers stay serialised on top of this cap regardless.
 */
function widestParallelism(nodes: GraphNode[]): number {
  const groups = new Map<string, number>();
  for (const node of nodes) {
    const key = [...node.dependsOn].sort().join('|');
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return Math.max(1, ...groups.values());
}

/**
 * Dependency order, with declaration order breaking ties.
 *
 * A repair loop makes the dependency graph cyclic, so a strict topological sort
 * would not terminate. Nodes still waiting when no progress is possible are
 * appended in their existing order rather than dropped — the runtime's own
 * validator is what decides whether that cycle is legal.
 */
function topological(nodes: GraphNode[]): GraphNode[] {
  const remaining = [...nodes];
  const placed = new Set<string>();
  const result: GraphNode[] = [];

  while (remaining.length > 0) {
    const index = remaining.findIndex((node) =>
      node.dependsOn.every(
        (dependency) => placed.has(dependency) || !nodes.some((n) => n.id === dependency),
      ),
    );
    if (index === -1) {
      result.push(...remaining);
      break;
    }
    const [node] = remaining.splice(index, 1);
    placed.add(node!.id);
    result.push(node!);
  }

  return result;
}

export function graphIrToWorkflowGraph(ir: GraphIR): BridgeResult {
  const diagnostics: Diagnostic[] = [];
  const irById = new Map(ir.nodes.map((node) => [node.id, node]));
  const downstreamOfCheck = nodesAfterChecks(ir);

  // --- Nodes -----------------------------------------------------------------
  const dependsOn = new Map<string, string[]>(ir.nodes.map((node) => [node.id, []]));
  for (const edge of ir.edges) {
    if (!SUCCESS_OUTCOMES.has(edge.from.outcome)) continue;
    dependsOn.get(edge.to.nodeId)?.push(edge.from.nodeId);
  }

  // The legacy validator insists a cycle contain some retry budget. When a node
  // in the loop already declares one, that rule is satisfied and nothing else
  // needs a budget it never asked for — a planner given four attempts because
  // it happens to sit in a repair loop would quietly quadruple its billable
  // calls. Only when no member declares one does the loop's own budget stand in.
  const loopByTarget = new Map<string, LoopGroup>();
  for (const loop of ir.loops) {
    const alreadyBudgeted = loop.nodeIds.some((id) => {
      const member = ir.nodes.find((candidate) => candidate.id === id);
      return member !== undefined && (retryBudget(member) ?? 1) > 1;
    });
    if (alreadyBudgeted) continue;
    for (const edgeId of loop.edgeIds) {
      const edge = ir.edges.find((candidate) => candidate.id === edgeId);
      if (edge) loopByTarget.set(edge.to.nodeId, loop);
    }
  }

  const siblings = parallelSiblings(ir, dependsOn);

  const nodes: GraphNode[] = [];
  for (const node of ir.nodes) {
    const kind = KINDS[node.kind];
    const role = dispatchRole(node, ir, downstreamOfCheck);
    if (kind === undefined || role === undefined) {
      diagnostics.push(
        error(
          DiagnosticCode.UnknownNode,
          `Node '${node.id}' has kind '${node.kind}', which the current runtime cannot execute. Supported kinds: agent, model_call, check, action, human.`,
        ),
      );
      continue;
    }

    const loop = loopByTarget.get(node.id);

    nodes.push({
      id: node.id,
      role,
      kind,
      dependsOn: dependsOn.get(node.id) ?? [],
      ...(node.kind === 'check' && node.check.required === true ? { required: true } : {}),
      ...(writes(node, ir) ? { writer: true } : {}),
      // A node's own retry budget and a loop's attempt budget are different
      // quantities: the first bounds retrying this node when it fails by
      // itself, the second bounds re-running the cycle after a verifier
      // rejects. An explicit budget wins. Falling back to the loop's is only
      // to satisfy the legacy validator's rule that a cycle must contain some
      // retry budget — the real ceiling is `maxLoopIterations` below.
      ...(retryBudget(node) !== undefined
        ? { maxAttempts: retryBudget(node) }
        : loop === undefined
          ? {}
          : { maxAttempts: loop.policy.maxAttempts }),
      // `focus` is a swarm assignment, not a job description: the runtime
      // injects it to tell parallel agents sharing one role how their
      // assignments differ. A node with no sibling has nothing to be
      // distinguished from, and giving it one would put a line in its prompt
      // that the built-in templates never sent.
      ...(siblings.has(node.id) ? { focus: objectiveOf(node) } : {}),
      // Authority enforcement is opt-in and explicit: a role must declare the
      // profile it answers to. Deriving it from the role's *name* would mean a
      // role innocently called `planner` silently acquired artifact gates its
      // author never asked for, and would fail runs for a reason nothing in the
      // source explains.
      ...(authorityProfile(node, ir) === undefined
        ? {}
        : { authorityRole: authorityProfile(node, ir) }),
    });
  }

  // Node order is presentation, not scheduling — readiness decides what runs —
  // but the runtime sorts a run's results by it, and IR arrives sorted by id
  // for hashing. Left alphabetical, a bug-fix run would report Accept before
  // Builder. Ordering topologically makes the run read the way it executed.
  const ordered = topological(nodes);

  // --- Edges -----------------------------------------------------------------
  const legacyEdges: GraphEdge[] = [];
  for (const node of ordered) {
    for (const dependency of node.dependsOn) {
      legacyEdges.push({ from: dependency, to: node.id, when: 'always' });
    }
  }

  // Priority decides which of several eligible failure routes the runtime
  // takes, and it takes the first match in edge order. A workflow that sends a
  // failing check back to the writer when the repair is in scope and to the
  // planner otherwise depends on that ordering, and IR arrives sorted by id.
  const failureEdges = ir.edges
    .filter((edge) => !SUCCESS_OUTCOMES.has(edge.from.outcome))
    .sort((a, b) => a.priority - b.priority);

  for (const edge of failureEdges) {
    const source = irById.get(edge.from.nodeId);
    const outcome = source?.outcomes.find((candidate) => candidate.id === edge.from.outcome);
    if (outcome?.terminal) {
      diagnostics.push(
        error(
          DiagnosticCode.UnknownOutcome,
          `Edge '${edge.id}' routes out of terminal outcome '${edge.from.outcome}' on '${edge.from.nodeId}'. A terminal outcome ends the run.`,
        ),
      );
      continue;
    }
    const when = FAILURE_CONDITIONS[edge.from.outcome];
    if (when === undefined) {
      diagnostics.push(
        error(
          DiagnosticCode.UnknownOutcome,
          `Outcome '${edge.from.outcome}' on '${edge.from.nodeId}' has no equivalent failure route in the current runtime`,
        ),
      );
      continue;
    }

    const target = ordered.find((candidate) => candidate.id === edge.to.nodeId);
    // The runtime refuses to send a failed deterministic check back through a
    // writer unless a repair-envelope policy says the repair is in scope. That
    // gate is a v3 invariant and the bridge must not route around it.
    const needsRepairEnvelope =
      when === 'on_fail' && source?.kind === 'check' && target?.writer === true;

    legacyEdges.push({
      from: edge.from.nodeId,
      to: edge.to.nodeId,
      when,
      ...(needsRepairEnvelope ? { guard: 'repair_envelope' as const } : {}),
    });
  }

  // --- Loop ceiling ----------------------------------------------------------
  //
  // IR carries one budget per loop group; legacy carries two bounds — a
  // per-node retry budget and a per-run ceiling on failure-edge traversals.
  // They are not the same quantity. `max 3` means three attempts, which is two
  // re-entries, so the ceiling is one less than the attempt count. Setting it
  // equal would silently buy every loop an extra billable attempt.
  const maxLoopIterations = ir.loops.reduce(
    (widest, loop) => Math.max(widest, loop.policy.maxAttempts - 1),
    0,
  );

  const graph: WorkflowGraph = {
    id: ir.workflow.id,
    version: `${ir.workflow.id}@${GRAPH_SCHEMA_VERSION}`,
    label: ir.workflow.name,
    description: ir.workflow.description ?? '',
    nodes: ordered,
    edges: legacyEdges,
    maxConcurrency: ir.policies.concurrency?.maxParallelNodes ?? widestParallelism(ordered),
    maxLoopIterations,
  };

  if (diagnostics.length > 0) return { diagnostics };

  // The legacy validator is the authority on whether the runtime will accept
  // this graph. Running it here turns a runtime throw into a diagnostic the
  // caller can report against source.
  const structural = validateGraph(graph);
  if (structural.length > 0) {
    return {
      diagnostics: structural.map((message) =>
        error(DiagnosticCode.UnknownNode, `Runtime rejected the bridged graph: ${message}`),
      ),
    };
  }

  return { graph, diagnostics };
}
