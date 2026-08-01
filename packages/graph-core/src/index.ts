import type { RiskClass, TaskType } from '@roleflock/contracts';
import { ROLE_AUTHORITY_MATRIX, type RoleId as AuthorityRoleId } from '@roleflock/role-protocol';

export type GraphMode = 'direct' | 'fast' | 'standard' | 'bug_fix' | 'critical' | 'assured';

/** Modes that predate `assured`, and so have retained v1/v2 shapes. */
export type LegacyGraphMode = Exclude<GraphMode, 'assured'>;

/**
 * The dispatch key the orchestrator uses to decide what a node actually does.
 * Node ids stay distinct from roles so a graph may run the same role twice —
 * for example a second writer pass after a failed verification.
 */
export type WorkflowRole = 'planner' | 'reviewer' | 'writer' | 'test' | 'verifier' | 'accept';

export type NodeKind =
  | 'agent'
  | 'model_call'
  | 'command'
  | 'test'
  | 'router'
  | 'join'
  | 'human_approval'
  | 'context_compile'
  | 'evidence_aggregate';

/**
 * Typed conditional edges. `always` edges form the happy path; the rest are
 * failure routes selected by the runtime's failure classification.
 */
export type EdgeCondition =
  | 'always'
  | 'on_pass'
  | 'on_fail'
  | 'on_needs_changes'
  | 'on_timeout'
  | 'on_provider_error'
  | 'on_budget_exhausted';

export interface GraphNode {
  id: string;
  role: WorkflowRole;
  kind: NodeKind;
  dependsOn: string[];
  /**
   * A deterministic gate. Acceptance may not be reached on a path that skips a
   * required node, and a required node's failure can never route to accept.
   */
  required?: boolean;
  /** Mutates the worktree. At most one per graph, never scheduled in parallel. */
  writer?: boolean;
  /** Bounded local retries. Absent means a single attempt. */
  maxAttempts?: number;
  /** Distinct read-only assignment for parallel agents sharing the same role/model. */
  focus?: string;
  /**
   * Enforceable authority identity for delivery-assurance graphs. Omitted only
   * by legacy graph versions whose historical prompts predate Role Protocol.
   */
  authorityRole?: AuthorityRoleId;
}

export interface GraphEdge {
  from: string;
  to: string;
  when: EdgeCondition;
  /** A deterministic policy predicate required before this edge may be taken. */
  guard?: 'repair_envelope';
}

export interface WorkflowGraph {
  id: GraphMode;
  /** Immutable identity of this graph's shape; a running task keeps its version. */
  version: string;
  label: string;
  description: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Upper bound on nodes running at once. Writers are additionally serialised. */
  maxConcurrency: number;
  /** Total re-entries into any loop, across the whole run. */
  maxLoopIterations: number;
  /**
   * Makes the assurance chain mandatory rather than opportunistic.
   *
   * Every other mode verifies through the assurance path when a task happens to
   * carry an authorised contract, an approved plan, and a frozen verification
   * specification, and quietly drops to the writer's own worktree check when it
   * does not. On a graph marked here the orchestrator must fail instead, so a
   * result cannot be presented as independently verified when the inputs that
   * make independence meaningful were absent.
   */
  requiresAssurance?: true;
}

export interface WorkflowRecommendation {
  mode: GraphMode;
  rationale: string;
  overridable: true;
}

/** Bumped when the shape of a built-in template changes. */
export const GRAPH_SCHEMA_VERSION = 3;

export function graphVersionId(mode: GraphMode): string {
  return `${mode}@${GRAPH_SCHEMA_VERSION}`;
}

/** Accepts both a bare mode (`bug_fix`) and a versioned id (`bug_fix@1`). */
export function parseGraphVersionId(value: string): { mode: string; version?: number } {
  const [mode, version] = value.split('@');
  return { mode: mode ?? value, version: version ? Number(version) : undefined };
}

function node(
  id: string,
  role: WorkflowRole,
  kind: NodeKind,
  dependsOn: string[],
  extra: Omit<GraphNode, 'id' | 'role' | 'kind' | 'dependsOn'> = {},
): GraphNode {
  return { id, role, kind, dependsOn, ...extra };
}

function sequential(nodes: GraphNode[]): GraphEdge[] {
  return nodes
    .slice(1)
    .map((current, index) => ({ from: nodes[index]!.id, to: current.id, when: 'always' as const }));
}

const bugFixNodes: GraphNode[] = [
  node('planner', 'planner', 'agent', [], {
    focus:
      'Trace the implementation path, identify the root cause, and propose the smallest safe code change.',
  }),
  node('planner_tests', 'planner', 'agent', [], {
    focus:
      'Independently inspect tests and failure modes. Propose regression coverage and verification risks.',
  }),
  node('reviewer', 'reviewer', 'human_approval', ['planner', 'planner_tests']),
  node('writer', 'writer', 'agent', ['reviewer'], { writer: true, maxAttempts: 2 }),
  node('test', 'test', 'test', ['writer'], { required: true }),
  node('verifier', 'verifier', 'agent', ['test']),
  node('accept', 'accept', 'human_approval', ['verifier']),
];

/**
 * A failed deterministic check routes back to the writer rather than failing the
 * run outright. The loop is bounded by the writer's `maxAttempts` and the
 * graph's `maxLoopIterations`.
 */
const bugFixEdges: GraphEdge[] = [
  ...bugFixNodes.flatMap((current) =>
    current.dependsOn.map((from) => ({ from, to: current.id, when: 'always' as const })),
  ),
  { from: 'test', to: 'writer', when: 'on_fail', guard: 'repair_envelope' },
  { from: 'test', to: 'planner', when: 'on_fail' },
  { from: 'verifier', to: 'planner', when: 'on_needs_changes' },
];

export const bugFixGraph: WorkflowGraph = {
  id: 'bug_fix',
  version: graphVersionId('bug_fix'),
  label: 'Verified Bug Fix',
  description:
    'Parallel planning → reviewer → writer → test → verifier; findings return to planner → human accept',
  nodes: bugFixNodes,
  edges: bugFixEdges,
  maxConcurrency: 2,
  maxLoopIterations: 3,
};

const directNodes: GraphNode[] = [
  node('writer', 'writer', 'agent', [], { writer: true, maxAttempts: 2 }),
  node('test', 'test', 'test', ['writer'], { required: true }),
  node('accept', 'accept', 'human_approval', ['test']),
];

/** Smallest path: write + deterministic test + human accept. No reviewer. */
export const directGraph: WorkflowGraph = {
  id: 'direct',
  version: graphVersionId('direct'),
  label: 'Direct',
  description: 'Writer → test → human accept',
  nodes: directNodes,
  edges: [
    ...sequential(directNodes),
    { from: 'test', to: 'writer', when: 'on_fail', guard: 'repair_envelope' },
  ],
  maxConcurrency: 1,
  maxLoopIterations: 2,
};

const fastNodes: GraphNode[] = [
  node('planner', 'planner', 'agent', []),
  node('writer', 'writer', 'agent', ['planner'], { writer: true, maxAttempts: 2 }),
  node('test', 'test', 'test', ['writer'], { required: true }),
  node('accept', 'accept', 'human_approval', ['test']),
];

/** Fast path: plan lightly, write, test, accept. */
export const fastGraph: WorkflowGraph = {
  id: 'fast',
  version: graphVersionId('fast'),
  label: 'Fast',
  description: 'Planner → writer → test → human accept',
  nodes: fastNodes,
  edges: [
    ...sequential(fastNodes),
    { from: 'test', to: 'writer', when: 'on_fail', guard: 'repair_envelope' },
    { from: 'test', to: 'planner', when: 'on_fail' },
  ],
  maxConcurrency: 1,
  maxLoopIterations: 2,
};

/** Standard path: plan, review, write, test, verify, accept. */
export const standardGraph: WorkflowGraph = {
  ...bugFixGraph,
  id: 'standard',
  version: graphVersionId('standard'),
  label: 'Standard',
  description: 'Parallel code + test analysis → reviewer → writer → test → verifier → human accept',
};

/** Critical feature: bug-fix shape with a wider loop budget for higher-risk work. */
export const criticalGraph: WorkflowGraph = {
  ...bugFixGraph,
  id: 'critical',
  version: graphVersionId('critical'),
  label: 'Critical Feature',
  description:
    'High-risk path: parallel code + test analysis → reviewer → writer → test → verifier → human accept',
  maxLoopIterations: 4,
};

/**
 * The canonical assured path.
 *
 * Structurally this is the bug-fix shape; what makes it different is that the
 * assurance chain is required rather than opportunistic, and that the planner
 * node carries real authority — `authorityRole: 'planner'` is what makes the
 * orchestrator compile the planner's turn into a versioned plan proposal bound
 * to the authorised contract, instead of leaving it as free prose.
 *
 * The remaining nodes deliberately carry no `authorityRole` yet. Those gates
 * require artifacts the runtime does not present today — a plan critique, a
 * plan approval, an execution report, a test attestation — and declaring the
 * role without producing its artifact would fail every run rather than assure
 * it. They are added as each artifact becomes real.
 */
const assuredNodes: GraphNode[] = [
  node('planner', 'planner', 'agent', [], {
    authorityRole: 'planner',
    focus:
      'Trace the implementation path, identify the root cause, and propose the smallest safe code change.',
  }),
  node('planner_tests', 'planner', 'agent', [], {
    focus:
      'Independently inspect tests and failure modes. Propose regression coverage and verification risks.',
  }),
  node('reviewer', 'reviewer', 'human_approval', ['planner', 'planner_tests']),
  node('writer', 'writer', 'agent', ['reviewer'], { writer: true, maxAttempts: 2 }),
  node('test', 'test', 'test', ['writer'], { required: true }),
  node('verifier', 'verifier', 'agent', ['test']),
  node('accept', 'accept', 'human_approval', ['verifier']),
];

export const assuredGraph: WorkflowGraph = {
  id: 'assured',
  version: graphVersionId('assured'),
  label: 'Assured',
  description:
    'Contract-bound planning → reviewer → writer → independent verification of the sealed commit → human accept',
  nodes: assuredNodes,
  edges: [
    ...assuredNodes.flatMap((current) =>
      current.dependsOn.map((from) => ({ from, to: current.id, when: 'always' as const })),
    ),
    { from: 'test', to: 'writer', when: 'on_fail', guard: 'repair_envelope' },
    { from: 'test', to: 'planner', when: 'on_fail' },
    { from: 'verifier', to: 'planner', when: 'on_needs_changes' },
  ],
  maxConcurrency: 2,
  maxLoopIterations: 3,
  requiresAssurance: true,
};

export const workflowGraphs: Record<GraphMode, WorkflowGraph> = {
  direct: directGraph,
  fast: fastGraph,
  standard: standardGraph,
  bug_fix: bugFixGraph,
  critical: criticalGraph,
  assured: assuredGraph,
};

const legacyBugFixNodes: GraphNode[] = [
  node('planner', 'planner', 'agent', []),
  node('reviewer', 'reviewer', 'human_approval', ['planner']),
  node('writer', 'writer', 'agent', ['reviewer'], { writer: true, maxAttempts: 2 }),
  node('test', 'test', 'test', ['writer'], { required: true }),
  node('verifier', 'verifier', 'agent', ['test']),
  node('accept', 'accept', 'human_approval', ['verifier']),
];

const legacyGraphs: Record<LegacyGraphMode, WorkflowGraph> = {
  direct: {
    ...directGraph,
    version: 'direct@1',
    edges: [...sequential(directNodes), { from: 'test', to: 'writer', when: 'on_fail' }],
  },
  fast: {
    ...fastGraph,
    version: 'fast@1',
    edges: [...sequential(fastNodes), { from: 'test', to: 'writer', when: 'on_fail' }],
  },
  bug_fix: {
    ...bugFixGraph,
    version: 'bug_fix@1',
    description: 'Planner → reviewer → writer → test → verifier → human accept',
    nodes: legacyBugFixNodes,
    edges: [
      ...sequential(legacyBugFixNodes),
      { from: 'test', to: 'writer', when: 'on_fail' },
      { from: 'verifier', to: 'writer', when: 'on_needs_changes' },
    ],
    maxConcurrency: 1,
  },
  standard: {
    ...bugFixGraph,
    id: 'standard',
    version: 'standard@1',
    label: 'Standard',
    nodes: legacyBugFixNodes,
    edges: [
      ...sequential(legacyBugFixNodes),
      { from: 'test', to: 'writer', when: 'on_fail' },
      { from: 'verifier', to: 'writer', when: 'on_needs_changes' },
    ],
    maxConcurrency: 1,
  },
  critical: {
    ...bugFixGraph,
    id: 'critical',
    version: 'critical@1',
    label: 'Critical Feature',
    nodes: legacyBugFixNodes,
    edges: [
      ...sequential(legacyBugFixNodes),
      { from: 'test', to: 'writer', when: 'on_fail' },
      { from: 'verifier', to: 'writer', when: 'on_needs_changes' },
    ],
    maxConcurrency: 1,
    maxLoopIterations: 4,
  },
};

const previousBugFixEdges: GraphEdge[] = [
  ...bugFixNodes.flatMap((current) =>
    current.dependsOn.map((from) => ({ from, to: current.id, when: 'always' as const })),
  ),
  { from: 'test', to: 'writer', when: 'on_fail' },
  { from: 'verifier', to: 'writer', when: 'on_needs_changes' },
];

/** Exact v2 shapes remain available for tasks created before planner-owned routing. */
const previousGraphsV2: Record<LegacyGraphMode, WorkflowGraph> = {
  direct: {
    ...directGraph,
    version: 'direct@2',
    edges: [...sequential(directNodes), { from: 'test', to: 'writer', when: 'on_fail' }],
  },
  fast: {
    ...fastGraph,
    version: 'fast@2',
    edges: [...sequential(fastNodes), { from: 'test', to: 'writer', when: 'on_fail' }],
  },
  bug_fix: {
    ...bugFixGraph,
    version: 'bug_fix@2',
    description:
      'Parallel code + test analysis → reviewer → writer → test → verifier → human accept',
    edges: previousBugFixEdges,
  },
  standard: {
    ...standardGraph,
    version: 'standard@2',
    description:
      'Parallel code + test analysis → reviewer → writer → test → verifier → human accept',
    edges: previousBugFixEdges,
  },
  critical: {
    ...criticalGraph,
    version: 'critical@2',
    description:
      'High-risk path: parallel code + test analysis → reviewer → writer → test → verifier → human accept',
    edges: previousBugFixEdges,
  },
};

/**
 * Resolves a graph by mode or versioned id. A version that does not match the
 * current schema is rejected rather than silently upgraded: a task must keep the
 * graph it started with, and a stale run should surface instead of drifting.
 */
export function getWorkflowGraph(modeOrVersion: string): WorkflowGraph {
  const { mode, version } = parseGraphVersionId(modeOrVersion);
  // `assured` was introduced at the current schema version, so it has no v1 or
  // v2 shape to retain. Asking for one is a stale reference, not a graph to
  // reconstruct, and is rejected rather than silently answered with v3.
  const graph =
    version === 1
      ? legacyGraphs[mode as LegacyGraphMode]
      : version === 2
        ? previousGraphsV2[mode as LegacyGraphMode]
        : workflowGraphs[mode as GraphMode];
  if (!graph) throw new Error(`Unknown workflow mode: ${modeOrVersion}`);
  if (version !== undefined && version !== 1 && version !== 2 && version !== GRAPH_SCHEMA_VERSION) {
    throw new Error(
      `Workflow graph ${mode} version ${version} is no longer available (current: ${GRAPH_SCHEMA_VERSION})`,
    );
  }
  return graph;
}

/**
 * Smallest-sufficient graph necessity gate.
 * Users may override the recommendation before start.
 */
export function recommendWorkflow(input: {
  type: TaskType;
  risk?: RiskClass;
}): WorkflowRecommendation {
  const risk = input.risk ?? 'medium';

  if (
    risk === 'critical' ||
    input.type === 'new_product' ||
    input.type === 'security_fix' ||
    input.type === 'migration'
  ) {
    return {
      mode: 'assured',
      rationale:
        'High-impact work must not fall back to a writer-side check: assurance is required, not opportunistic.',
      overridable: true,
    };
  }

  if (input.type === 'bug_fix') {
    return {
      mode: 'assured',
      rationale:
        'A verified fix is only worth the extra steps when the verdict is independent, so assurance is required.',
      overridable: true,
    };
  }

  if (
    input.type === 'investigation' ||
    input.type === 'review_changes' ||
    input.type === 'documentation'
  ) {
    return {
      mode: 'direct',
      rationale: 'Read-oriented or narrow work does not need a full planning graph.',
      overridable: true,
    };
  }

  if (
    risk === 'low' ||
    input.type === 'test_improvement' ||
    input.type === 'dependency_update' ||
    input.type === 'performance'
  ) {
    return {
      mode: 'fast',
      rationale: 'Low-risk localised changes can skip reviewer overhead.',
      overridable: true,
    };
  }

  if (risk === 'high') {
    return {
      mode: 'critical',
      rationale: 'Elevated risk warrants the critical verification path.',
      overridable: true,
    };
  }

  return {
    mode: 'standard',
    rationale: 'Default feature path balances planning, review, and verification.',
    overridable: true,
  };
}

const FAILURE_CONDITIONS: readonly EdgeCondition[] = [
  'on_fail',
  'on_needs_changes',
  'on_timeout',
  'on_provider_error',
  'on_budget_exhausted',
];

export function isFailureCondition(condition: EdgeCondition): boolean {
  return FAILURE_CONDITIONS.includes(condition);
}

/** Nodes reachable from `start` by following `dependsOn` forwards. */
function descendants(graph: WorkflowGraph, start: string): Set<string> {
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

/** Nodes that must complete before `start`, transitively. */
function ancestors(graph: WorkflowGraph, start: string): Set<string> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const walk = (id: string) => {
    for (const dependency of byId.get(id)?.dependsOn ?? []) {
      if (seen.has(dependency)) continue;
      seen.add(dependency);
      walk(dependency);
    }
  };
  walk(start);
  return seen;
}

/** Cycles across the combined dependency + edge graph, as node id lists. */
function findCycles(graph: WorkflowGraph): string[][] {
  const successors = new Map<string, string[]>();
  for (const n of graph.nodes) successors.set(n.id, []);
  for (const n of graph.nodes) {
    for (const dependency of n.dependsOn) successors.get(dependency)?.push(n.id);
  }
  for (const edge of graph.edges) successors.get(edge.from)?.push(edge.to);

  const cycles: string[][] = [];
  const stack: string[] = [];
  const onStack = new Set<string>();
  const visited = new Set<string>();

  const walk = (id: string) => {
    if (onStack.has(id)) {
      cycles.push(stack.slice(stack.indexOf(id)));
      return;
    }
    if (visited.has(id)) return;
    visited.add(id);
    onStack.add(id);
    stack.push(id);
    for (const next of successors.get(id) ?? []) walk(next);
    stack.pop();
    onStack.delete(id);
  };

  for (const n of graph.nodes) walk(n.id);
  return cycles;
}

/**
 * Structural safety gate. Every rule here corresponds to a way a graph could run
 * forever, corrupt a worktree, or reach acceptance without the evidence the user
 * was promised.
 */
export function validateGraph(graph: WorkflowGraph): string[] {
  const errors: string[] = [];
  const ids = new Set(graph.nodes.map((n) => n.id));

  if (graph.nodes.length === 0) errors.push('graph has no nodes');
  if (ids.size !== graph.nodes.length) errors.push('duplicate node id');
  if (!Number.isFinite(graph.maxConcurrency) || graph.maxConcurrency < 1) {
    errors.push('maxConcurrency must be a finite integer >= 1');
  }
  if (!Number.isFinite(graph.maxLoopIterations) || graph.maxLoopIterations < 0) {
    errors.push('maxLoopIterations must be a finite integer >= 0');
  }

  const writers = graph.nodes.filter((n) => n.writer);
  if (writers.length > 1) errors.push('parallel writers are not allowed');
  if (writers.length === 0) errors.push('graph requires a writer node');

  // A mode that promises assurance must be shaped so it can deliver it. Without
  // these the run could reach acceptance having never produced an independent
  // verdict, which is the overstatement the flag exists to prevent.
  if (graph.requiresAssurance) {
    if (!graph.nodes.some((n) => n.role === 'test' && n.required)) {
      errors.push('assured graph requires a required deterministic test node');
    }
    if (!graph.nodes.some((n) => n.role === 'verifier')) {
      errors.push('assured graph requires an independent verifier node');
    }
    if (!graph.nodes.some((n) => n.role === 'planner' && n.authorityRole === 'planner')) {
      errors.push('assured graph requires a planner node holding planner authority');
    }
    if (!graph.nodes.some((n) => n.role === 'accept' && n.kind === 'human_approval')) {
      errors.push('assured graph requires human acceptance');
    }
  }

  const acceptNodes = graph.nodes.filter((n) => n.role === 'accept');
  if (acceptNodes.length === 0) errors.push('graph requires a terminal accept node');
  for (const accept of acceptNodes) {
    if (graph.nodes.some((n) => n.dependsOn.includes(accept.id))) {
      errors.push(`${accept.id} must be terminal`);
    }
  }

  for (const n of graph.nodes) {
    if (n.maxAttempts !== undefined && (!Number.isFinite(n.maxAttempts) || n.maxAttempts < 1)) {
      errors.push(`${n.id} has a non-finite retry budget`);
    }
    for (const dependency of n.dependsOn) {
      if (!ids.has(dependency)) errors.push(`${n.id} depends on missing ${dependency}`);
      if (dependency === n.id) errors.push(`${n.id} depends on itself`);
    }
    if (n.authorityRole !== undefined) {
      const authority = ROLE_AUTHORITY_MATRIX[n.authorityRole];
      if (n.writer && authority.permissionProfile.repository !== 'planned_write') {
        errors.push(`${n.id} gives writer authority to read-only role ${n.authorityRole}`);
      }
      if (!n.writer && n.authorityRole === 'executor') {
        errors.push(`${n.id} assigns executor authority without a writer lease`);
      }
    }
  }

  // Invalid state references.
  for (const edge of graph.edges) {
    if (!ids.has(edge.from)) errors.push(`edge from unknown node ${edge.from}`);
    if (!ids.has(edge.to)) errors.push(`edge to unknown node ${edge.to}`);
    const graphVersion = parseGraphVersionId(graph.version).version ?? GRAPH_SCHEMA_VERSION;
    const target = graph.nodes.find((node) => node.id === edge.to);
    const source = graph.nodes.find((node) => node.id === edge.from);
    if (
      graphVersion >= 3 &&
      source?.role === 'test' &&
      target?.writer &&
      edge.when === 'on_fail' &&
      edge.guard !== 'repair_envelope'
    ) {
      errors.push(
        `incompatible fallback: ${edge.from} can repair through ${edge.to} without repair_envelope`,
      );
    }
  }

  // Unbounded cycles: a loop is only legal if the runtime can exhaust it.
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const cycle of findCycles(graph)) {
    const conditional = cycle.some((id, index) => {
      const next = cycle[(index + 1) % cycle.length]!;
      return graph.edges.some((e) => e.from === id && e.to === next && isFailureCondition(e.when));
    });
    if (!conditional) {
      errors.push(`unconditional cycle: ${cycle.join(' → ')}`);
      continue;
    }
    if (!cycle.some((id) => (byId.get(id)?.maxAttempts ?? 1) > 1)) {
      errors.push(`unbounded cycle without a retry budget: ${cycle.join(' → ')}`);
    }
  }

  // A pass path may not bypass a required deterministic check.
  const required = graph.nodes.filter((n) => n.required);
  for (const accept of acceptNodes) {
    const before = ancestors(graph, accept.id);
    for (const check of required) {
      if (!before.has(check.id)) {
        errors.push(`${accept.id} can be reached without required check ${check.id}`);
      }
    }
  }

  // Incompatible fallback: failure must not shortcut to acceptance, and a
  // "needs changes" route only makes sense towards something that can write.
  for (const edge of graph.edges) {
    if (!isFailureCondition(edge.when)) continue;
    const target = byId.get(edge.to);
    if (!target) continue;
    if (target.role === 'accept') {
      errors.push(`incompatible fallback: ${edge.from} routes ${edge.when} straight to accept`);
    }
    const source = byId.get(edge.from);
    const graphVersion = parseGraphVersionId(graph.version).version ?? GRAPH_SCHEMA_VERSION;
    if (
      edge.when === 'on_needs_changes' &&
      source?.role === 'verifier' &&
      graphVersion >= 3 &&
      target.role !== 'planner'
    ) {
      errors.push(
        `incompatible fallback: verifier ${edge.from} must route findings to planner, not ${edge.to}`,
      );
    } else if (edge.when === 'on_needs_changes' && source?.role !== 'verifier' && !target.writer) {
      errors.push(
        `incompatible fallback: ${edge.from} routes on_needs_changes to non-writer ${edge.to}`,
      );
    }
    if (
      edge.when === 'on_needs_changes' &&
      source?.authorityRole === 'verifier' &&
      target.authorityRole === 'executor'
    ) {
      errors.push(
        `incompatible fallback: verifier ${edge.from} routes findings directly to executor ${edge.to}`,
      );
    }
  }

  // Acceptance must actually be reachable from the writer.
  for (const writer of writers) {
    const reachable = descendants(graph, writer.id);
    if (acceptNodes.length && !acceptNodes.some((a) => reachable.has(a.id))) {
      errors.push(`accept is unreachable from ${writer.id}`);
    }
  }

  return errors;
}

/** @deprecated use WorkflowRole */
export type BugFixRole = WorkflowRole;
