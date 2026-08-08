import {
  CODING_EXTENSION,
  DiagnosticCode,
  createGraphIR,
  defaultOutcomes,
  isExecutable,
  stampSemanticHash,
  validateGraphIR,
  type ArtifactType,
  type Diagnostic,
  type GraphEdge,
  type GraphIR,
  type GraphNode,
  type LoopGroup,
  type Port,
  type RoleDefinition,
  type SourceSpan,
} from '@roleflock/graph-ir';
import type { Declaration, SourceFile, Transition } from './ast.js';
import { parse } from './parser.js';

export const LANGUAGE_VERSION = '0.1';

/**
 * Where a node's own retry budget is carried.
 *
 * Distinct from a loop group's attempt budget: a loop bounds how many times the
 * *cycle* re-runs after a verifier rejects, while this bounds how many times a
 * single node is retried when it fails on its own — a provider error, say. IR
 * v1 has no field for the latter, and adding one to the frozen NodeBase schema
 * needs an RFC, so it travels as a namespaced annotation until then.
 */
export const RETRY_BUDGET_ANNOTATION = 'roflock.coding/retry-budget';

const CODING_DISPATCH_SLOTS = new Set([
  'planner',
  'reviewer',
  'writer',
  'test',
  'verifier',
  'accept',
]);

export interface CompileResult {
  ir?: GraphIR;
  diagnostics: Diagnostic[];
}

export interface CompileOptions {
  uri?: string;
  /** Defaults to the workflow declaration's name, then to the file's basename. */
  workflowId?: string;
  supportedExtensions?: readonly string[];
}

function err(code: DiagnosticCode, message: string, span?: SourceSpan): Diagnostic {
  return span ? { code, severity: 'error', message, span } : { code, severity: 'error', message };
}

/**
 * Lowers a parsed `.roflock` file into Graph IR.
 *
 * The compiler derives three things the author never writes, which is most of
 * why an AST and IR are separate:
 *
 * - **Outcomes**, from node kind. An author writes `check Tests`; the contract
 *   that Tests may report `pass`, `fail` or `timeout` — and nothing else —
 *   comes from here.
 * - **Entry nodes**, as the nodes nothing routes into.
 * - **Loop groups**, by finding the strongly connected components a `{ max N }`
 *   transition creates. The author states a budget on one edge; the compiler
 *   works out which nodes that budget actually governs.
 */
export function compile(source: string, options: CompileOptions = {}): CompileResult {
  const parsed = parse(source, options.uri);
  if (!parsed.file) return { diagnostics: parsed.diagnostics };
  return lower(parsed.file, source, options, parsed.diagnostics);
}

function lower(
  file: SourceFile,
  source: string,
  options: CompileOptions,
  carried: Diagnostic[],
): CompileResult {
  const diagnostics = [...carried];
  const declarations = file.declarations;

  // --- Duplicate names -------------------------------------------------------
  const declaredAt = new Map<string, SourceSpan>();
  const nodeDeclarations = declarations.filter((d) =>
    ['agent', 'check', 'action', 'human'].includes(d.kind),
  );
  for (const declaration of [
    ...nodeDeclarations,
    ...declarations.filter((d) => d.kind === 'role' || d.kind === 'artifact'),
  ]) {
    const key = `${declaration.kind === 'role' ? 'role:' : declaration.kind === 'artifact' ? 'artifact:' : 'node:'}${declaration.name}`;
    if (declaredAt.has(key)) {
      diagnostics.push(
        err(
          DiagnosticCode.DuplicateDeclaration,
          `'${declaration.name}' is declared more than once`,
          declaration.span,
        ),
      );
    }
    declaredAt.set(key, declaration.span);
  }

  // --- Roles and artifacts ---------------------------------------------------
  const roles: RoleDefinition[] = declarations
    .filter((d): d is Extract<Declaration, { kind: 'role' }> => d.kind === 'role')
    .map((role) => ({
      id: role.name,
      name: role.name,
      ...(role.accessMode === undefined ? {} : { accessMode: role.accessMode }),
      ...(role.requires.length === 0 ? {} : { requiredCapabilities: role.requires }),
      ...(role.authority === undefined ? {} : { permissionProfileRef: role.authority }),
    }));

  const artifacts: ArtifactType[] = declarations
    .filter((d): d is Extract<Declaration, { kind: 'artifact' }> => d.kind === 'artifact')
    .map((artifact) => ({ id: artifact.name, name: artifact.name }));

  // --- Nodes -----------------------------------------------------------------
  const nodeSpans: Record<string, SourceSpan> = {};
  const nodes: GraphNode[] = [];

  const port = (artifactType: string, required: boolean): Port => ({
    name: artifactType.toLowerCase(),
    artifactType,
    required,
    cardinality: 'one',
  });

  for (const declaration of nodeDeclarations) {
    nodeSpans[declaration.name] = declaration.span;
    switch (declaration.kind) {
      case 'agent': {
        const effects = declaration.effects.map((effect) => ({
          class: effect.effect,
          risk: effect.risk,
        }));
        // A role that may write implies the effect, so an author does not have
        // to state the same authority twice and cannot state it inconsistently.
        const role = roles.find((candidate) => candidate.id === declaration.role);
        if (role?.accessMode === 'write' && !effects.some((e) => e.class === 'workspace_write')) {
          effects.push({ class: 'workspace_write', risk: 'medium' });
        }
        nodes.push({
          id: declaration.name,
          name: declaration.name,
          kind: 'agent',
          roleRef: declaration.role ?? '',
          // `reviews` widens the contract: this agent may also send work back.
          // Without it an agent cannot report `changes`, so no edge can be
          // drawn from that outcome and no reviewer loop can exist.
          outcomes: declaration.reviews
            ? [...defaultOutcomes('agent'), { id: 'changes' }]
            : defaultOutcomes('agent'),
          ...(declaration.retry === undefined
            ? {}
            : { annotations: { [RETRY_BUDGET_ANNOTATION]: String(declaration.retry) } }),
          agent: {
            objective: declaration.objective ?? `Run ${declaration.name}`,
            mode: 'tool_loop',
          },
          ...(declaration.consumes.length === 0
            ? {}
            : { inputs: declaration.consumes.map((a) => port(a, true)) }),
          ...(declaration.produces.length === 0
            ? {}
            : { outputs: declaration.produces.map((a) => port(a, true)) }),
          ...(effects.length === 0 ? {} : { effects }),
        });
        if (declaration.role === undefined) {
          diagnostics.push(
            err(
              DiagnosticCode.UnknownRole,
              `Agent '${declaration.name}' does not declare a role. An agent's authority comes from its role, so it cannot be omitted.`,
              declaration.span,
            ),
          );
        }
        break;
      }
      case 'check': {
        if (declaration.run === undefined) {
          diagnostics.push(
            err(
              DiagnosticCode.UnknownNode,
              `Check '${declaration.name}' declares no command to run`,
              declaration.span,
            ),
          );
        }
        nodes.push({
          id: declaration.name,
          name: declaration.name,
          kind: 'check',
          outcomes: defaultOutcomes('check'),
          ...(declaration.retry === undefined
            ? {}
            : { annotations: { [RETRY_BUDGET_ANNOTATION]: String(declaration.retry) } }),
          check: {
            driver: 'command',
            operation: declaration.run ?? '',
            ...(declaration.required ? { required: true } : {}),
          },
          ...(declaration.consumes.length === 0
            ? {}
            : { inputs: declaration.consumes.map((a) => port(a, true)) }),
          ...(declaration.produces.length === 0
            ? {}
            : { outputs: declaration.produces.map((a) => port(a, true)) }),
        });
        break;
      }
      case 'action': {
        nodes.push({
          id: declaration.name,
          name: declaration.name,
          kind: 'action',
          outcomes: defaultOutcomes('action'),
          action: { driver: 'command', operation: declaration.run ?? '' },
          ...(declaration.effects.length === 0
            ? {}
            : {
                effects: declaration.effects.map((effect) => ({
                  class: effect.effect,
                  risk: effect.risk,
                })),
              }),
        });
        break;
      }
      case 'human': {
        const decisions = declaration.decisions.length
          ? declaration.decisions
          : ['approve', 'reject'];
        nodes.push({
          id: declaration.name,
          name: declaration.name,
          kind: 'human',
          outcomes: [
            { id: 'human_approved', terminal: true, accepted: true },
            { id: 'human_rejected', terminal: true },
          ],
          human: {
            requestType: 'approval',
            title: declaration.title ?? declaration.name,
            allowedDecisions: decisions,
          },
        });
        break;
      }
      default:
        break;
    }
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  // --- Edges -----------------------------------------------------------------
  const edges: GraphEdge[] = [];
  const edgeSpans: Record<string, SourceSpan> = {};
  const boundedEdges = new Map<string, number>();
  const transitions: Transition[] = file.flows.flatMap((flow) => flow.transitions);

  transitions.forEach((transition, index) => {
    const from = nodeById.get(transition.from);
    const to = nodeById.get(transition.to);
    if (!from) {
      diagnostics.push(
        err(
          DiagnosticCode.UnknownNode,
          `Flow references undeclared node '${transition.from}'`,
          transition.span,
        ),
      );
    }
    if (!to) {
      diagnostics.push(
        err(
          DiagnosticCode.UnknownNode,
          `Flow references undeclared node '${transition.to}'`,
          transition.span,
        ),
      );
    }
    if (!from || !to) return;

    const outcome = transition.fromOutcome ?? primaryOutcome(from);
    if (!from.outcomes.some((candidate) => candidate.id === outcome)) {
      diagnostics.push(
        err(
          DiagnosticCode.UnknownOutcome,
          `'${transition.from}' cannot report outcome '${outcome}'. It declares: ${from.outcomes.map((o) => o.id).join(', ')}`,
          transition.fromOutcomeSpan ?? transition.span,
        ),
      );
      return;
    }

    const id = `e${index + 1}`;
    edges.push({
      id,
      from: { nodeId: transition.from, outcome },
      to: { nodeId: transition.to },
      priority: index,
    });
    edgeSpans[id] = transition.span;
    if (transition.max !== undefined) {
      if (!Number.isInteger(transition.max) || transition.max < 1) {
        diagnostics.push(
          err(
            DiagnosticCode.UnboundedCycle,
            `Retry limit must be a positive integer`,
            transition.span,
          ),
        );
      } else {
        boundedEdges.set(id, transition.max);
      }
    }
  });

  // --- Human gates -----------------------------------------------------------
  //
  // A human node is only the accept gate when nothing follows it. One in the
  // middle of a flow — a reviewer signing off a plan before work starts — is a
  // gate the run passes through, and marking its approval terminal would end
  // the run at the review.
  const hasOutgoing = new Set(edges.map((edge) => edge.from.nodeId));
  for (const node of nodes) {
    if (node.kind !== 'human' || !hasOutgoing.has(node.id)) continue;
    node.outcomes = node.outcomes.map((outcome) =>
      outcome.id === 'human_approved' ? { id: 'human_approved' } : outcome,
    );
  }

  // --- Entry nodes -----------------------------------------------------------
  const entryNodeIds = deriveEntryNodes(nodes, edges);
  if (nodes.length > 0 && entryNodeIds.length === 0) {
    diagnostics.push(
      err(
        DiagnosticCode.NoEntryNode,
        'Every node is the target of a transition, so the workflow has no entry point',
      ),
    );
  }

  // --- Loop groups -----------------------------------------------------------
  const loops = deriveLoops(nodes, edges, boundedEdges, diagnostics, edgeSpans);

  // --- Assemble --------------------------------------------------------------
  // Coding-pack conventions travel in a namespaced extension rather than in
  // core IR, which knows nothing about verifiers. A role that declares no
  // dispatch slot is left out entirely, so the adapter falls back to inference.
  const declaredDispatch: Record<string, string> = {};
  for (const declaration of declarations) {
    if (declaration.kind !== 'role' || declaration.dispatch === undefined) continue;
    if (!CODING_DISPATCH_SLOTS.has(declaration.dispatch)) {
      diagnostics.push(
        err(
          DiagnosticCode.UnknownRole,
          `Unknown dispatch slot '${declaration.dispatch}'. Expected one of: ${[...CODING_DISPATCH_SLOTS].join(', ')}`,
          declaration.span,
        ),
      );
      continue;
    }
    declaredDispatch[declaration.name] = declaration.dispatch;
  }

  const workflowDecl = declarations.find(
    (d): d is Extract<Declaration, { kind: 'workflow' }> => d.kind === 'workflow',
  );
  const workflowId = options.workflowId ?? workflowDecl?.name ?? file.flows[0]?.name ?? 'workflow';

  const terminalNodeIds = nodes
    .filter((node) => node.outcomes.some((outcome) => outcome.terminal))
    .map((node) => node.id);

  const ir = createGraphIR({
    workflow: {
      id: workflowId,
      name: workflowDecl?.name ?? workflowId,
      version: workflowDecl?.version ?? '0.1.0',
      entryNodeIds,
      terminalNodeIds,
      ...(workflowDecl?.description === undefined ? {} : { description: workflowDecl.description }),
      source: {
        language: 'roflock',
        languageVersion: LANGUAGE_VERSION,
        ...(options.uri === undefined ? {} : { uri: options.uri }),
        sourceHash: sourceHashOf(source),
      },
    },
    roles,
    artifacts,
    nodes,
    edges,
    loops,
    policies: {
      // The coding profile default per RFC-001 §15.2. A worktree cannot safely
      // take two concurrent writers, and nothing in v0.1 lets an author opt out.
      concurrency: { oneWriterPerWorkspace: true, writerScope: 'worktree' },
      ...(workflowDecl?.maxCost === undefined
        ? {}
        : {
            // Pause rather than fail: hitting a ceiling is a question for the
            // operator, not a reason to discard work already paid for.
            budget: { actualCostLimit: workflowDecl.maxCost, onExceeded: 'pause' as const },
          }),
    },
    ...(Object.keys(declaredDispatch).length === 0
      ? {}
      : { extensions: { [CODING_EXTENSION]: { dispatch: declaredDispatch } } }),
    debug: { sourceMap: { nodes: nodeSpans, edges: edgeSpans } },
  });

  if (!isExecutable(diagnostics)) return { diagnostics };

  // Structural mistakes are reported against source spans before the IR
  // validator runs, so a user sees "line 12" rather than "node Builder".
  diagnostics.push(
    ...validateGraphIR(ir, {
      // The compiler understands its own coding extension; a host that does not
      // will reject the document, which is the intended behaviour.
      supportedExtensions: [CODING_EXTENSION, ...(options.supportedExtensions ?? [])],
    }),
  );
  if (!isExecutable(diagnostics)) return { diagnostics };

  return { ir: stampSemanticHash(ir), diagnostics };
}

/**
 * Nodes a run can start at.
 *
 * "Nothing points at it" is not enough. In `Builder -> Tests` plus
 * `Tests.fail -> Builder`, Builder is pointed at by its own repair loop, so a
 * naive rule finds no entry at all — and a rule that merely ignores back edges
 * makes *both* loop members entries, since each is reachable from the other.
 *
 * Collapsing each cycle to a single vertex removes the ambiguity: a workflow
 * starts wherever nothing outside it can lead, so the entries are the source
 * components of the condensation. Within a cycle the earliest declaration wins,
 * which is the node the author wrote first and the one a reader would expect to
 * run first.
 */
function deriveEntryNodes(nodes: GraphNode[], edges: GraphEdge[]): string[] {
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  const components = stronglyConnectedComponents(nodes, edges);
  const componentOf = new Map<string, number>();
  components.forEach((members, index) => {
    for (const id of members) componentOf.set(id, index);
  });

  const hasExternalIncoming = new Set<number>();
  for (const edge of edges) {
    const from = componentOf.get(edge.from.nodeId);
    const to = componentOf.get(edge.to.nodeId);
    if (from !== undefined && to !== undefined && from !== to) hasExternalIncoming.add(to);
  }

  return components
    .map((members, index) => ({ members, index }))
    .filter(({ index }) => !hasExternalIncoming.has(index))
    .map(
      ({ members }) => [...members].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))[0]!,
    )
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

/**
 * How far each node sits along the success path, longest-first.
 *
 * Used only to pick which of several rejection gates in one cycle is the final
 * arbiter. Failure edges are excluded because they run backwards by definition
 * and would make every node in a loop equidistant.
 */
function successDepth(nodes: GraphNode[], edges: GraphEdge[]): Map<string, number> {
  const depth = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    if (!SUCCESS_EDGE_OUTCOMES.has(edge.from.outcome)) continue;
    incoming.set(edge.to.nodeId, [...(incoming.get(edge.to.nodeId) ?? []), edge.from.nodeId]);
  }
  // Relax repeatedly; bounded by node count because success edges form a DAG.
  for (let pass = 0; pass < nodes.length; pass += 1) {
    for (const node of nodes) {
      for (const source of incoming.get(node.id) ?? []) {
        depth.set(node.id, Math.max(depth.get(node.id) ?? 0, (depth.get(source) ?? 0) + 1));
      }
    }
  }
  return depth;
}

const SUCCESS_EDGE_OUTCOMES = new Set(['completed', 'pass', 'human_approved']);

/** Tarjan. Every node belongs to exactly one component. */
function stronglyConnectedComponents(nodes: GraphNode[], edges: GraphEdge[]): string[][] {
  const successors = new Map<string, Set<string>>();
  for (const node of nodes) successors.set(node.id, new Set());
  for (const edge of edges) successors.get(edge.from.nodeId)?.add(edge.to.nodeId);

  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  const visit = (id: string) => {
    index.set(id, counter);
    low.set(id, counter);
    counter += 1;
    stack.push(id);
    onStack.add(id);

    for (const next of successors.get(id) ?? []) {
      if (!index.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(id, Math.min(low.get(id)!, index.get(next)!));
      }
    }

    if (low.get(id) === index.get(id)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
      } while (member !== id);
      components.push(component);
    }
  };

  for (const node of nodes) if (!index.has(node.id)) visit(node.id);
  return components;
}

/** The outcome an unqualified `A -> B` transition means. */
function primaryOutcome(node: GraphNode): string {
  switch (node.kind) {
    case 'check':
      return 'pass';
    case 'human':
      return 'human_approved';
    default:
      return 'completed';
  }
}

/**
 * Turns `{ max N }` transitions into loop groups.
 *
 * One group per cycle, not per annotated edge. A workflow that routes a failing
 * check both back to the writer and further back to the planner has two bounded
 * edges inside one strongly connected component, and emitting a group for each
 * would hand the same nodes two competing attempt budgets — which the IR
 * validator rightly rejects as ambiguous. Grouping by component gives that
 * cycle a single budget, which is what the author meant.
 *
 * The verifier is the node the bounded edges leave: whatever judged the attempt
 * and decided it was not good enough. A cycle can legitimately have more than
 * one such gate — a deterministic check rejecting a build, and a reviewer later
 * asking for changes — so the one furthest along the success path is named as
 * the loop's verifier. It is the last word on whether an attempt succeeded, and
 * the budget is shared by every route out of the cycle either way.
 */
function deriveLoops(
  nodes: GraphNode[],
  edges: GraphEdge[],
  boundedEdges: Map<string, number>,
  diagnostics: Diagnostic[],
  spans: Record<string, SourceSpan>,
): LoopGroup[] {
  if (boundedEdges.size === 0) return [];

  const components = stronglyConnectedComponents(nodes, edges);
  const componentOf = new Map<string, number>();
  components.forEach((members, index) => {
    for (const id of members) componentOf.set(id, index);
  });

  const grouped = new Map<number, string[]>();
  for (const edgeId of boundedEdges.keys()) {
    const edge = edges.find((candidate) => candidate.id === edgeId)!;
    const component = componentOf.get(edge.from.nodeId);
    const targetComponent = componentOf.get(edge.to.nodeId);
    if (component === undefined || component !== targetComponent) {
      diagnostics.push(
        err(
          DiagnosticCode.UnboundedCycle,
          `Transition '${edge.from.nodeId} -> ${edge.to.nodeId}' declares a retry budget but does not close a cycle`,
          spans[edgeId],
        ),
      );
      continue;
    }
    grouped.set(component, [...(grouped.get(component) ?? []), edgeId]);
  }

  const loops: LoopGroup[] = [];
  let counter = 0;
  for (const [component, edgeIds] of [...grouped.entries()].sort((a, b) => a[0] - b[0])) {
    const members = components[component]!;
    const verifiers = [
      ...new Set(
        edgeIds.map((edgeId) => edges.find((candidate) => candidate.id === edgeId)!.from.nodeId),
      ),
    ];
    const depth = successDepth(nodes, edges);
    const verifier = verifiers.sort((a, b) => (depth.get(a) ?? 0) - (depth.get(b) ?? 0)).at(-1)!;
    // Several bounded edges from one verifier describe one decision with
    // several destinations, so the widest budget governs the cycle.
    const maxAttempts = Math.max(...edgeIds.map((edgeId) => boundedEdges.get(edgeId)!));

    counter += 1;
    loops.push({
      id: `loop${counter}`,
      nodeIds: [...members].sort(),
      edgeIds: [...edgeIds].sort(),
      policy: {
        objective: `Retry until '${verifier}' succeeds`,
        verifierNodeId: verifier,
        maxAttempts,
        // v0.1 always requires new evidence: a retry against unchanged inputs
        // burns budget and bills a provider for a result already known.
        requireNewEvidence: true,
        exhaustion: { action: 'fail' },
      },
    });
  }

  return loops;
}

/**
 * Hash of the source bytes. Non-semantic — it detects that a file changed, not
 * that its meaning did, and is excluded from the semantic hash.
 */
function sourceHashOf(source: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;
}
