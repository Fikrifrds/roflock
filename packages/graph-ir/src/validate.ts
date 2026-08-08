import { DiagnosticCode, error, warning, type Diagnostic } from './diagnostics.js';
import {
  DEFAULT_PROTECTED_EFFECTS,
  IR_VERSION,
  type EffectClass,
  type GraphEdge,
  type GraphIR,
  type GraphNode,
} from './types.js';

/**
 * Graph IR invariant validator (RFC-001 IR-02).
 *
 * Every rule here corresponds to a way a workflow could run forever, corrupt a
 * workspace, reach acceptance without the evidence a user was promised, or
 * perform a protected side effect nobody approved. It is deliberately usable on
 * IR from any frontend — hand-written JSON, the `.roflock` compiler, or a future
 * visual editor — because none of them is trusted to have checked already.
 *
 * Fails closed: anything affecting execution safety is an `error`.
 */

export interface ValidateOptions {
  /** Extension namespaces this host understands. Unknown required ones are rejected. */
  supportedExtensions?: readonly string[];
  /** Effects that may not run without an approval path. Defaults to the protected set. */
  protectedEffects?: readonly EffectClass[];
}

interface Analysis {
  byId: Map<string, GraphNode>;
  outgoing: Map<string, GraphEdge[]>;
  successors: Map<string, Set<string>>;
  reachable: Set<string>;
}

function analyse(ir: GraphIR): Analysis {
  const byId = new Map(ir.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, GraphEdge[]>();
  const successors = new Map<string, Set<string>>();
  for (const node of ir.nodes) {
    outgoing.set(node.id, []);
    successors.set(node.id, new Set());
  }
  for (const edge of ir.edges) {
    outgoing.get(edge.from.nodeId)?.push(edge);
    successors.get(edge.from.nodeId)?.add(edge.to.nodeId);
  }

  const reachable = new Set<string>();
  const queue = ir.workflow.entryNodeIds.filter((id) => byId.has(id));
  while (queue.length) {
    const id = queue.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const next of successors.get(id) ?? []) queue.push(next);
  }

  return { byId, outgoing, successors, reachable };
}

/** Tarjan: every strongly connected component containing at least one cycle. */
function cyclicComponents(ir: GraphIR, successors: Map<string, Set<string>>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];
  let counter = 0;

  const strongConnect = (id: string) => {
    index.set(id, counter);
    low.set(id, counter);
    counter += 1;
    stack.push(id);
    onStack.add(id);

    for (const next of successors.get(id) ?? []) {
      if (!index.has(next)) {
        strongConnect(next);
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

      const selfLoop = component.length === 1 && successors.get(id)?.has(id);
      if (component.length > 1 || selfLoop) components.push(component);
    }
  };

  for (const node of ir.nodes) if (!index.has(node.id)) strongConnect(node.id);
  return components;
}

/** Nodes present on every path from `entry` to an accepted terminal. */
function nodesOnEveryAcceptedPath(ir: GraphIR, analysis: Analysis): Set<string> {
  const accepted = new Set(
    ir.nodes
      .filter((node) => node.outcomes.some((outcome) => outcome.terminal && outcome.accepted))
      .map((node) => node.id),
  );
  if (accepted.size === 0) return new Set();

  // Walk every simple path from each entry to an accepted terminal and
  // intersect. Graphs are small and authored by hand; clarity beats cleverness.
  const paths: Set<string>[] = [];
  const walk = (id: string, seen: Set<string>) => {
    if (seen.has(id)) return;
    const next = new Set(seen).add(id);
    if (accepted.has(id)) {
      paths.push(next);
      return;
    }
    const edges = analysis.outgoing.get(id) ?? [];
    for (const edge of edges) walk(edge.to.nodeId, next);
  };
  for (const entry of ir.workflow.entryNodeIds) walk(entry, new Set());

  if (paths.length === 0) return new Set();
  return paths.reduce((common, path) => new Set([...common].filter((id) => path.has(id))));
}

export function validateGraphIR(ir: GraphIR, options: ValidateOptions = {}): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const spanOf = (id: string) => ir.debug?.sourceMap?.nodes?.[id];

  // --- Version and extensions ------------------------------------------------
  const [major] = ir.irVersion.split('.');
  if (major !== IR_VERSION.split('.')[0]) {
    diagnostics.push(
      error(
        DiagnosticCode.UnsupportedIrVersion,
        `Graph IR major version ${ir.irVersion} is not supported (this host implements ${IR_VERSION})`,
      ),
    );
  }
  const supported = new Set(options.supportedExtensions ?? []);
  for (const namespace of Object.keys(ir.extensions ?? {})) {
    if (!supported.has(namespace)) {
      // Silently ignoring an extension would let a document mean more than the
      // host can enforce.
      diagnostics.push(
        error(
          DiagnosticCode.UnsupportedExtension,
          `Unsupported extension namespace '${namespace}'. A host that cannot interpret an extension must not execute the workflow.`,
        ),
      );
    }
  }

  // --- Duplicate declarations ------------------------------------------------
  const seen = (label: string, ids: string[]) => {
    const counts = new Map<string, number>();
    for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    for (const [id, count] of counts) {
      if (count > 1) {
        diagnostics.push(
          error(DiagnosticCode.DuplicateDeclaration, `Duplicate ${label} id '${id}'`),
        );
      }
    }
  };
  seen(
    'node',
    ir.nodes.map((n) => n.id),
  );
  seen(
    'edge',
    ir.edges.map((e) => e.id),
  );
  seen(
    'role',
    ir.roles.map((r) => r.id),
  );
  seen(
    'artifact type',
    ir.artifacts.map((a) => a.id),
  );
  seen(
    'loop group',
    ir.loops.map((l) => l.id),
  );

  const analysis = analyse(ir);
  const { byId, successors, reachable } = analysis;
  const roleIds = new Set(ir.roles.map((role) => role.id));
  const artifactIds = new Set(ir.artifacts.map((artifact) => artifact.id));

  // --- References ------------------------------------------------------------
  if (ir.workflow.entryNodeIds.length === 0) {
    diagnostics.push(error(DiagnosticCode.NoEntryNode, 'Workflow declares no entry node'));
  }
  for (const id of ir.workflow.entryNodeIds) {
    if (!byId.has(id)) {
      diagnostics.push(error(DiagnosticCode.UnknownNode, `Entry node '${id}' does not exist`));
    }
  }
  for (const id of ir.workflow.terminalNodeIds) {
    if (!byId.has(id)) {
      diagnostics.push(error(DiagnosticCode.UnknownNode, `Terminal node '${id}' does not exist`));
    }
  }

  for (const node of ir.nodes) {
    if (node.roleRef !== undefined && !roleIds.has(node.roleRef)) {
      diagnostics.push(
        error(
          DiagnosticCode.UnknownRole,
          `Node '${node.id}' references unknown role '${node.roleRef}'`,
          spanOf(node.id),
        ),
      );
    }
    for (const port of [...(node.inputs ?? []), ...(node.outputs ?? [])]) {
      if (!artifactIds.has(port.artifactType)) {
        diagnostics.push(
          error(
            DiagnosticCode.ArtifactTypeMismatch,
            `Node '${node.id}' port '${port.name}' references unknown artifact type '${port.artifactType}'`,
            spanOf(node.id),
          ),
        );
      }
    }
    if (node.outcomes.length === 0) {
      diagnostics.push(
        error(
          DiagnosticCode.UnknownOutcome,
          `Node '${node.id}' declares no outcomes`,
          spanOf(node.id),
        ),
      );
    }
    if (node.timeout?.onTimeout === 'route' && node.timeout.outcome === undefined) {
      diagnostics.push(
        error(
          DiagnosticCode.UnknownOutcome,
          `Node '${node.id}' routes on timeout without naming an outcome`,
          spanOf(node.id),
        ),
      );
    }
  }

  for (const edge of ir.edges) {
    const from = byId.get(edge.from.nodeId);
    if (!from) {
      diagnostics.push(
        error(
          DiagnosticCode.UnknownNode,
          `Edge '${edge.id}' leaves unknown node '${edge.from.nodeId}'`,
        ),
      );
    } else if (!from.outcomes.some((outcome) => outcome.id === edge.from.outcome)) {
      // The heart of "control stays outside agents": an edge may only be drawn
      // from an outcome the node contractually declares.
      diagnostics.push(
        error(
          DiagnosticCode.UnknownOutcome,
          `Edge '${edge.id}' leaves node '${edge.from.nodeId}' on undeclared outcome '${edge.from.outcome}'`,
        ),
      );
    }
    if (!byId.has(edge.to.nodeId)) {
      diagnostics.push(
        error(
          DiagnosticCode.UnknownNode,
          `Edge '${edge.id}' enters unknown node '${edge.to.nodeId}'`,
        ),
      );
    }
  }

  for (const profile of ir.profiles) {
    for (const binding of profile.bindings) {
      if (!roleIds.has(binding.roleId)) {
        diagnostics.push(
          error(
            DiagnosticCode.UnknownProfileRole,
            `Profile '${profile.id}' binds unknown role '${binding.roleId}'`,
          ),
        );
      }
    }
  }

  // --- Reachability and terminals -------------------------------------------
  for (const node of ir.nodes) {
    if (!reachable.has(node.id)) {
      diagnostics.push(
        error(
          DiagnosticCode.UnreachableNode,
          `Node '${node.id}' is not reachable from any entry node`,
          spanOf(node.id),
        ),
      );
    }
  }

  const terminalNodes = ir.nodes.filter((node) =>
    node.outcomes.some((outcome) => outcome.terminal),
  );
  if (terminalNodes.length === 0) {
    diagnostics.push(
      error(DiagnosticCode.MissingTerminal, 'Workflow declares no terminal outcome'),
    );
  } else if (!terminalNodes.some((node) => reachable.has(node.id))) {
    diagnostics.push(
      error(DiagnosticCode.MissingTerminal, 'No terminal outcome is reachable from an entry node'),
    );
  }

  // --- Cycles and loop policy ------------------------------------------------
  const loopByNode = new Map<string, (typeof ir.loops)[number]>();
  for (const loop of ir.loops) {
    for (const nodeId of loop.nodeIds) loopByNode.set(nodeId, loop);
    if (!byId.has(loop.policy.verifierNodeId)) {
      diagnostics.push(
        error(
          DiagnosticCode.UnknownNode,
          `Loop '${loop.id}' names unknown verifier '${loop.policy.verifierNodeId}'`,
        ),
      );
    } else if (!loop.nodeIds.includes(loop.policy.verifierNodeId)) {
      // A verifier outside the cycle can never re-run, so the loop would have
      // no way to observe whether the retry helped.
      diagnostics.push(
        error(
          DiagnosticCode.LoopVerifierUnreachable,
          `Loop '${loop.id}' verifier '${loop.policy.verifierNodeId}' is outside the loop and cannot re-evaluate an attempt`,
        ),
      );
    }
    if (!Number.isInteger(loop.policy.maxAttempts) || loop.policy.maxAttempts < 1) {
      diagnostics.push(
        error(DiagnosticCode.UnboundedCycle, `Loop '${loop.id}' has a non-finite attempt budget`),
      );
    }
    if (!loop.policy.requireNewEvidence) {
      diagnostics.push(
        warning(
          DiagnosticCode.RetryWithoutNewEvidence,
          `Loop '${loop.id}' permits a retry without new evidence, so an identical attempt can burn the budget`,
        ),
      );
    }
  }

  for (const component of cyclicComponents(ir, successors)) {
    if (!component.some((id) => reachable.has(id))) continue;
    const governing = new Set(component.map((id) => loopByNode.get(id)?.id));
    if (governing.has(undefined)) {
      diagnostics.push(
        error(
          DiagnosticCode.UnboundedCycle,
          `Cycle ${component.join(' → ')} is not covered by a loop group with a bounded policy`,
        ),
      );
    } else if (governing.size > 1) {
      diagnostics.push(
        error(
          DiagnosticCode.UnboundedCycle,
          `Cycle ${component.join(' → ')} spans multiple loop groups (${[...governing].join(', ')}); its attempt budget is ambiguous`,
        ),
      );
    }
  }

  // --- Writer safety ---------------------------------------------------------
  const concurrency = ir.policies.concurrency;
  const writers = ir.nodes.filter(
    (node) =>
      node.effects?.some((effect) => effect.class === 'workspace_write') ||
      (node.roleRef !== undefined &&
        ir.roles.find((role) => role.id === node.roleRef)?.accessMode === 'write'),
  );
  if (concurrency?.oneWriterPerWorkspace) {
    // Two writers are only safe when they cannot be scheduled together, which
    // here means one must be an ancestor of the other on every path.
    for (const a of writers) {
      for (const b of writers) {
        if (a.id >= b.id) continue;
        if (!canRunConcurrently(a.id, b.id, analysis)) continue;
        diagnostics.push(
          error(
            DiagnosticCode.ConcurrentWriters,
            `Nodes '${a.id}' and '${b.id}' can both write the workspace concurrently, but the workflow declares one writer per workspace`,
            spanOf(a.id),
          ),
        );
      }
    }
  }

  // --- Effects and approvals -------------------------------------------------
  const protectedEffects = new Set<EffectClass>(
    options.protectedEffects ?? [
      ...(ir.policies.approval?.protectedEffects ?? DEFAULT_PROTECTED_EFFECTS),
    ],
  );
  const humanNodeIds = new Set(ir.nodes.filter((node) => node.kind === 'human').map((n) => n.id));
  for (const node of ir.nodes) {
    for (const effect of node.effects ?? []) {
      if (!protectedEffects.has(effect.class)) continue;
      if (!hasApprovalUpstream(node.id, humanNodeIds, ir, analysis)) {
        diagnostics.push(
          error(
            DiagnosticCode.ProtectedEffectWithoutApproval,
            `Node '${node.id}' performs protected effect '${effect.class}' but no human approval is guaranteed on the paths reaching it`,
            spanOf(node.id),
          ),
        );
      }
    }
    if (
      ir.policies.security?.denyUndeclaredSecrets &&
      usesSecrets(node) &&
      !declares(node, 'secret_access')
    ) {
      diagnostics.push(
        error(
          DiagnosticCode.UndeclaredSecretAccess,
          `Node '${node.id}' reads a secret-confidential artifact without declaring 'secret_access'`,
          spanOf(node.id),
        ),
      );
    }
  }

  // --- Artifacts -------------------------------------------------------------
  for (const node of ir.nodes) {
    for (const input of node.inputs ?? []) {
      if (!input.required) continue;
      const producers = ir.nodes.filter((candidate) =>
        candidate.outputs?.some((output) => output.artifactType === input.artifactType),
      );
      if (producers.length === 0) {
        diagnostics.push(
          error(
            DiagnosticCode.MissingArtifactProducer,
            `Node '${node.id}' requires artifact '${input.artifactType}' but no node produces it`,
            spanOf(node.id),
          ),
        );
        continue;
      }
      if (!producers.some((producer) => reaches(producer.id, node.id, analysis))) {
        diagnostics.push(
          error(
            DiagnosticCode.MissingArtifactProducer,
            `Node '${node.id}' requires artifact '${input.artifactType}', but every producer runs after it`,
            spanOf(node.id),
          ),
        );
      }
    }
  }

  // --- Acceptance criteria ---------------------------------------------------
  for (const goal of ir.goals) {
    for (const criterion of goal.criteria) {
      const verifier = byId.get(criterion.verifier.nodeId);
      if (!verifier) {
        diagnostics.push(
          error(
            criterion.blocking
              ? DiagnosticCode.BlockingCriterionHasNoVerifier
              : DiagnosticCode.UnknownNode,
            `Acceptance criterion '${criterion.id}' names unknown verifier node '${criterion.verifier.nodeId}'`,
          ),
        );
        continue;
      }
      if (
        criterion.verifier.outcome !== undefined &&
        !verifier.outcomes.some((outcome) => outcome.id === criterion.verifier.outcome)
      ) {
        diagnostics.push(
          error(
            DiagnosticCode.UnknownOutcome,
            `Acceptance criterion '${criterion.id}' expects outcome '${criterion.verifier.outcome}', which '${verifier.id}' does not declare`,
          ),
        );
      }
      if (criterion.blocking && !reachable.has(verifier.id)) {
        diagnostics.push(
          error(
            DiagnosticCode.BlockingCriterionHasNoVerifier,
            `Blocking criterion '${criterion.id}' is verified by unreachable node '${verifier.id}'`,
          ),
        );
      }
    }
  }

  // --- Required checks -------------------------------------------------------
  const mandatory = nodesOnEveryAcceptedPath(ir, analysis);
  for (const node of ir.nodes) {
    if (node.kind !== 'check' || node.check.required !== true) continue;
    if (!mandatory.has(node.id)) {
      diagnostics.push(
        error(
          DiagnosticCode.RequiredCheckBypassable,
          `Required check '${node.id}' can be bypassed: an accepted terminal is reachable without it`,
          spanOf(node.id),
        ),
      );
    }
  }

  // --- Budget ----------------------------------------------------------------
  if (ir.loops.length > 0 && ir.policies.budget === undefined) {
    diagnostics.push(
      warning(
        DiagnosticCode.MissingCostBoundary,
        'Workflow contains a retry loop but declares no budget policy, so repeated model work has no cost ceiling',
      ),
    );
  }

  return diagnostics;
}

function reaches(from: string, to: string, analysis: Analysis): boolean {
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length) {
    const id = queue.shift()!;
    if (id === to && id !== from) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of analysis.successors.get(id) ?? []) queue.push(next);
  }
  return false;
}

/** Neither node is guaranteed to precede the other, so a scheduler may overlap them. */
function canRunConcurrently(a: string, b: string, analysis: Analysis): boolean {
  return !reaches(a, b, analysis) && !reaches(b, a, analysis);
}

/**
 * True when every path from an entry to `nodeId` crosses a human node.
 *
 * Approval must be *guaranteed*, not merely possible: one unapproved path to a
 * deploy is enough to make the workflow unsafe.
 */
function hasApprovalUpstream(
  nodeId: string,
  humanNodeIds: Set<string>,
  ir: GraphIR,
  analysis: Analysis,
): boolean {
  let sawAnyPath = false;
  let allApproved = true;

  const walk = (current: string, seen: Set<string>, approved: boolean) => {
    if (current === nodeId) {
      sawAnyPath = true;
      if (!approved) allApproved = false;
      return;
    }
    if (seen.has(current)) return;
    const next = new Set(seen).add(current);
    const nowApproved = approved || humanNodeIds.has(current);
    for (const edge of analysis.outgoing.get(current) ?? []) {
      walk(edge.to.nodeId, next, nowApproved);
    }
  };

  for (const entry of ir.workflow.entryNodeIds) {
    walk(entry, new Set(), humanNodeIds.has(entry));
  }

  return sawAnyPath && allApproved;
}

function usesSecrets(node: GraphNode): boolean {
  return (node.annotations?.['reads_secret'] ?? '') === 'true';
}

function declares(node: GraphNode, effect: EffectClass): boolean {
  return node.effects?.some((candidate) => candidate.class === effect) ?? false;
}
