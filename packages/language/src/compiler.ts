import {
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
          outcomes: defaultOutcomes('agent'),
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
  const loops = deriveLoops(nodes, edges, boundedEdges, diagnostics);

  // --- Assemble --------------------------------------------------------------
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
    debug: { sourceMap: { nodes: nodeSpans, edges: edgeSpans } },
  });

  if (!isExecutable(diagnostics)) return { diagnostics };

  // Structural mistakes are reported against source spans before the IR
  // validator runs, so a user sees "line 12" rather than "node Builder".
  diagnostics.push(
    ...validateGraphIR(ir, {
      ...(options.supportedExtensions === undefined
        ? {}
        : { supportedExtensions: options.supportedExtensions }),
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
 * The author annotates the edge that closes a cycle; the budget governs every
 * node in the strongly connected component that edge creates, not just the two
 * it touches. In `Builder -> Tests, Tests.fail -> Builder { max 3 }` the group
 * is {Builder, Tests}, and the verifier is the node the back edge leaves —
 * the one whose verdict decides whether another attempt is warranted.
 */
function deriveLoops(
  nodes: GraphNode[],
  edges: GraphEdge[],
  boundedEdges: Map<string, number>,
  diagnostics: Diagnostic[],
): LoopGroup[] {
  if (boundedEdges.size === 0) return [];

  const successors = new Map<string, Set<string>>();
  for (const node of nodes) successors.set(node.id, new Set());
  for (const edge of edges) successors.get(edge.from.nodeId)?.add(edge.to.nodeId);

  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>();
    const queue = [from];
    while (queue.length) {
      const id = queue.shift()!;
      if (id === to) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const next of successors.get(id) ?? []) queue.push(next);
    }
    return false;
  };

  const loops: LoopGroup[] = [];
  let counter = 0;

  for (const [edgeId, maxAttempts] of boundedEdges) {
    const edge = edges.find((candidate) => candidate.id === edgeId)!;
    const target = edge.to.nodeId;
    const verifier = edge.from.nodeId;

    // Members of this cycle: everything reachable from the loop target that can
    // also reach back to the node closing the loop.
    const members = nodes
      .filter((node) => reaches(target, node.id) && reaches(node.id, verifier))
      .map((node) => node.id);

    if (!members.includes(target) || !members.includes(verifier)) {
      diagnostics.push(
        err(
          DiagnosticCode.UnboundedCycle,
          `Transition '${verifier} -> ${target}' declares a retry budget but does not close a cycle`,
        ),
      );
      continue;
    }

    counter += 1;
    loops.push({
      id: `loop${counter}`,
      nodeIds: members,
      edgeIds: [edgeId],
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
