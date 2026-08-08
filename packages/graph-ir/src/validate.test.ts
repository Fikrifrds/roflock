import { describe, expect, it } from 'vitest';
import { createGraphIR, defaultOutcomes } from './builder.js';
import { DiagnosticCode, isExecutable, type Diagnostic } from './diagnostics.js';
import type {
  ArtifactType,
  GraphEdge,
  GraphIR,
  GraphNode,
  LoopGroup,
  RoleDefinition,
} from './types.js';
import { validateGraphIR } from './validate.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function agent(id: string, roleRef: string, extra: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    name: id,
    kind: 'agent',
    roleRef,
    outcomes: defaultOutcomes('agent'),
    agent: { objective: `run ${id}`, mode: 'tool_loop' },
    ...extra,
  } as GraphNode;
}

function check(id: string, extra: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    name: id,
    kind: 'check',
    outcomes: defaultOutcomes('check'),
    check: { driver: 'command', operation: 'npm test', required: true },
    ...extra,
  } as GraphNode;
}

function human(id: string, extra: Partial<GraphNode> = {}): GraphNode {
  return {
    id,
    name: id,
    kind: 'human',
    outcomes: [
      { id: 'human_approved', terminal: true, accepted: true },
      { id: 'human_rejected', terminal: true },
    ],
    human: { requestType: 'approval', title: id, allowedDecisions: ['approve', 'reject'] },
    ...extra,
  } as GraphNode;
}

function edge(id: string, from: string, outcome: string, to: string, priority = 0): GraphEdge {
  return { id, from: { nodeId: from, outcome }, to: { nodeId: to }, priority };
}

const writerRole: RoleDefinition = { id: 'builder', name: 'Builder', accessMode: 'write' };
const readerRole: RoleDefinition = { id: 'reviewer', name: 'Reviewer', accessMode: 'readonly' };

function graph(parts: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  entry?: string[];
  roles?: RoleDefinition[];
  loops?: LoopGroup[];
  artifacts?: ArtifactType[];
  overrides?: Partial<GraphIR>;
}): GraphIR {
  const terminals = parts.nodes
    .filter((node) => node.outcomes.some((outcome) => outcome.terminal))
    .map((node) => node.id);
  return createGraphIR({
    workflow: {
      id: 'test',
      name: 'Test',
      version: '1.0.0',
      entryNodeIds: parts.entry ?? [parts.nodes[0]!.id],
      terminalNodeIds: terminals,
    },
    nodes: parts.nodes,
    edges: parts.edges,
    roles: parts.roles ?? [writerRole, readerRole],
    loops: parts.loops ?? [],
    artifacts: parts.artifacts ?? [],
    policies: { concurrency: { oneWriterPerWorkspace: true, writerScope: 'worktree' } },
    ...parts.overrides,
  });
}

function codes(diagnostics: Diagnostic[]): string[] {
  return diagnostics.filter((d) => d.severity === 'error').map((d) => d.code);
}

/** The canonical bounded builder/test loop the RFC uses as its worked example. */
function bugFixGraph(): GraphIR {
  const nodes = [
    agent('Builder', 'builder', { effects: [{ class: 'workspace_write', risk: 'medium' }] }),
    check('Tests'),
    human('Approval'),
  ];
  const edges = [
    edge('e1', 'Builder', 'completed', 'Tests'),
    edge('e2', 'Tests', 'pass', 'Approval'),
    edge('e3', 'Tests', 'fail', 'Builder'),
  ];
  const loops: LoopGroup[] = [
    {
      id: 'repair',
      nodeIds: ['Builder', 'Tests'],
      edgeIds: ['e3'],
      policy: {
        objective: 'make the tests pass',
        verifierNodeId: 'Tests',
        maxAttempts: 3,
        requireNewEvidence: true,
        exhaustion: { action: 'fail' },
      },
    },
  ];
  return graph({
    nodes,
    edges,
    loops,
    overrides: {
      policies: {
        concurrency: { oneWriterPerWorkspace: true, writerScope: 'worktree' },
        budget: { actualCostLimit: 5, onExceeded: 'pause' },
      },
    },
  });
}

// ---------------------------------------------------------------------------

describe('Graph IR validator — valid workflows', () => {
  it('accepts a linear A → B → C flow', () => {
    const ir = graph({
      nodes: [agent('A', 'reviewer'), agent('B', 'reviewer'), human('C')],
      edges: [edge('e1', 'A', 'completed', 'B'), edge('e2', 'B', 'completed', 'C')],
    });

    expect(validateGraphIR(ir)).toEqual([]);
  });

  it('accepts a check with pass and fail branches', () => {
    const ir = graph({
      nodes: [
        agent('Builder', 'builder'),
        check('Tests', { check: { driver: 'command', operation: 'npm test' } }),
        human('Approval'),
        human('Triage'),
      ],
      edges: [
        edge('e1', 'Builder', 'completed', 'Tests'),
        edge('e2', 'Tests', 'pass', 'Approval'),
        edge('e3', 'Tests', 'fail', 'Triage'),
      ],
    });

    expect(validateGraphIR(ir)).toEqual([]);
  });

  it('accepts a bounded builder/test loop', () => {
    expect(validateGraphIR(bugFixGraph())).toEqual([]);
  });

  it('accepts parallel read-only reviewers joined before acceptance', () => {
    const join: GraphNode = {
      id: 'Join',
      name: 'Join',
      kind: 'join',
      outcomes: defaultOutcomes('join'),
      join: {
        strategy: 'all_successful',
        requiredNodeIds: ['ReviewA', 'ReviewB'],
        preserveDisagreement: true,
      },
    };
    const ir = graph({
      nodes: [
        agent('Builder', 'builder'),
        agent('ReviewA', 'reviewer'),
        agent('ReviewB', 'reviewer'),
        join,
        human('Approval'),
      ],
      edges: [
        edge('e1', 'Builder', 'completed', 'ReviewA'),
        edge('e2', 'Builder', 'completed', 'ReviewB'),
        edge('e3', 'ReviewA', 'completed', 'Join'),
        edge('e4', 'ReviewB', 'completed', 'Join'),
        edge('e5', 'Join', 'completed', 'Approval'),
      ],
    });

    // Two read-only nodes running at once is exactly what the concurrency
    // policy is meant to allow; only writers are serialised.
    expect(validateGraphIR(ir)).toEqual([]);
  });

  it('accepts a protected deploy that every path approves first', () => {
    const deploy: GraphNode = {
      id: 'Deploy',
      name: 'Deploy',
      kind: 'action',
      outcomes: [
        { id: 'completed', terminal: true, accepted: true },
        { id: 'fail', terminal: true },
      ],
      action: { driver: 'command', operation: 'deploy' },
      effects: [{ class: 'deploy', risk: 'critical' }],
    };
    const gate: GraphNode = {
      id: 'Approval',
      name: 'Approval',
      kind: 'human',
      outcomes: [{ id: 'human_approved' }, { id: 'human_rejected', terminal: true }],
      human: { requestType: 'approval', title: 'Ship it', allowedDecisions: ['approve', 'reject'] },
    };
    const ir = graph({
      nodes: [agent('Builder', 'builder'), gate, deploy],
      edges: [
        edge('e1', 'Builder', 'completed', 'Approval'),
        edge('e2', 'Approval', 'human_approved', 'Deploy'),
      ],
    });

    expect(validateGraphIR(ir)).toEqual([]);
  });

  it('accepts an event-triggered non-coding workflow', () => {
    const trigger: GraphNode = {
      id: 'Ticket',
      name: 'Ticket',
      kind: 'event',
      outcomes: defaultOutcomes('event'),
      event: { eventType: 'ticket.created' },
    };
    const ir = graph({
      nodes: [trigger, agent('Research', 'reviewer'), human('Publish')],
      edges: [
        edge('e1', 'Ticket', 'completed', 'Research'),
        edge('e2', 'Research', 'completed', 'Publish'),
      ],
      entry: ['Ticket'],
    });

    // Nothing about the core model is coding-specific: no writer, no repository.
    expect(validateGraphIR(ir)).toEqual([]);
  });

  it('accepts an artifact chain whose producers all run before their consumers', () => {
    const artifacts: ArtifactType[] = [
      { id: 'Plan', name: 'Plan' },
      { id: 'Patch', name: 'Patch' },
      { id: 'TestReport', name: 'TestReport' },
    ];
    const ir = graph({
      nodes: [
        agent('Planner', 'reviewer', {
          outputs: [{ name: 'plan', artifactType: 'Plan', required: true, cardinality: 'one' }],
        }),
        agent('Builder', 'builder', {
          inputs: [{ name: 'plan', artifactType: 'Plan', required: true, cardinality: 'one' }],
          outputs: [{ name: 'patch', artifactType: 'Patch', required: true, cardinality: 'one' }],
        }),
        check('Tests', {
          inputs: [{ name: 'patch', artifactType: 'Patch', required: true, cardinality: 'one' }],
          outputs: [
            { name: 'report', artifactType: 'TestReport', required: true, cardinality: 'one' },
          ],
          check: { driver: 'command', operation: 'npm test' },
        }),
        human('Approval', {
          inputs: [
            { name: 'report', artifactType: 'TestReport', required: true, cardinality: 'one' },
          ],
        }),
      ],
      edges: [
        edge('e1', 'Planner', 'completed', 'Builder'),
        edge('e2', 'Builder', 'completed', 'Tests'),
        edge('e3', 'Tests', 'pass', 'Approval'),
      ],
      artifacts,
    });

    expect(validateGraphIR(ir)).toEqual([]);
  });

  it('accepts a profile swap without changing graph semantics', () => {
    const base = bugFixGraph();
    const swapped: GraphIR = {
      ...base,
      profiles: [
        {
          id: 'economical',
          name: 'Economical',
          bindings: [{ roleId: 'builder', driver: 'codex' }],
        },
      ],
    };

    expect(validateGraphIR(swapped)).toEqual([]);
  });
});

describe('Graph IR validator — rejected workflows', () => {
  it('rejects an edge into an unknown node', () => {
    const ir = graph({
      nodes: [agent('A', 'reviewer'), human('B')],
      edges: [edge('e1', 'A', 'completed', 'B'), edge('e2', 'B', 'human_approved', 'Ghost')],
    });

    expect(codes(validateGraphIR(ir))).toContain(DiagnosticCode.UnknownNode);
  });

  it('rejects an edge leaving an outcome the node never declares', () => {
    const ir = graph({
      nodes: [agent('A', 'reviewer'), human('B')],
      edges: [edge('e1', 'A', 'invented_outcome', 'B')],
    });

    // This is the invariant that keeps routing out of a model's hands: if an
    // undeclared outcome could carry an edge, an agent could choose a
    // transition the author never wrote.
    expect(codes(validateGraphIR(ir))).toContain(DiagnosticCode.UnknownOutcome);
  });

  it('rejects an unreachable node', () => {
    const ir = graph({
      nodes: [agent('A', 'reviewer'), human('B'), agent('Orphan', 'reviewer')],
      edges: [edge('e1', 'A', 'completed', 'B')],
      entry: ['A'],
    });

    expect(codes(validateGraphIR(ir))).toContain(DiagnosticCode.UnreachableNode);
  });

  it('rejects a workflow with no terminal outcome', () => {
    const ir = graph({
      nodes: [agent('A', 'reviewer'), agent('B', 'reviewer')],
      edges: [edge('e1', 'A', 'completed', 'B')],
    });

    expect(codes(validateGraphIR(ir))).toContain(DiagnosticCode.MissingTerminal);
  });

  it('rejects a cycle with no loop group governing it', () => {
    const ir = graph({
      nodes: [agent('Builder', 'builder'), check('Tests'), human('Approval')],
      edges: [
        edge('e1', 'Builder', 'completed', 'Tests'),
        edge('e2', 'Tests', 'pass', 'Approval'),
        edge('e3', 'Tests', 'fail', 'Builder'),
      ],
      loops: [],
    });

    expect(codes(validateGraphIR(ir))).toContain(DiagnosticCode.UnboundedCycle);
  });

  it('rejects a loop whose verifier sits outside the cycle', () => {
    const ir = bugFixGraph();
    const broken: GraphIR = {
      ...ir,
      loops: [
        {
          ...ir.loops[0]!,
          policy: { ...ir.loops[0]!.policy, verifierNodeId: 'Approval' },
        },
      ],
    };

    // A verifier that cannot re-run has no way to judge whether the retry
    // helped, so the loop would spend its budget blind.
    expect(codes(validateGraphIR(broken))).toContain(DiagnosticCode.LoopVerifierUnreachable);
  });

  it('rejects two writers that can run concurrently', () => {
    const ir = graph({
      nodes: [
        agent('Split', 'reviewer'),
        agent('WriterA', 'builder', { effects: [{ class: 'workspace_write', risk: 'medium' }] }),
        agent('WriterB', 'builder', { effects: [{ class: 'workspace_write', risk: 'medium' }] }),
        human('Approval'),
      ],
      edges: [
        edge('e1', 'Split', 'completed', 'WriterA'),
        edge('e2', 'Split', 'completed', 'WriterB'),
        edge('e3', 'WriterA', 'completed', 'Approval'),
        edge('e4', 'WriterB', 'completed', 'Approval'),
      ],
    });

    expect(codes(validateGraphIR(ir))).toContain(DiagnosticCode.ConcurrentWriters);
  });

  it('rejects a protected deploy reachable without approval', () => {
    const deploy: GraphNode = {
      id: 'Deploy',
      name: 'Deploy',
      kind: 'action',
      outcomes: [{ id: 'completed', terminal: true, accepted: true }],
      action: { driver: 'command', operation: 'deploy' },
      effects: [{ class: 'deploy', risk: 'critical' }],
    };
    const ir = graph({
      nodes: [agent('Builder', 'builder'), deploy],
      edges: [edge('e1', 'Builder', 'completed', 'Deploy')],
    });

    expect(codes(validateGraphIR(ir))).toContain(DiagnosticCode.ProtectedEffectWithoutApproval);
  });

  it('rejects a deploy that only one branch approves', () => {
    const deploy: GraphNode = {
      id: 'Deploy',
      name: 'Deploy',
      kind: 'action',
      outcomes: [{ id: 'completed', terminal: true, accepted: true }],
      action: { driver: 'command', operation: 'deploy' },
      effects: [{ class: 'deploy', risk: 'critical' }],
    };
    const gate: GraphNode = {
      id: 'Approval',
      name: 'Approval',
      kind: 'human',
      outcomes: [{ id: 'human_approved' }, { id: 'human_rejected', terminal: true }],
      human: { requestType: 'approval', title: 'Ship', allowedDecisions: ['approve', 'reject'] },
    };
    const ir = graph({
      nodes: [agent('Builder', 'builder'), gate, deploy],
      edges: [
        edge('e1', 'Builder', 'completed', 'Approval'),
        edge('e2', 'Approval', 'human_approved', 'Deploy'),
        // A "fast path" that skips the gate entirely.
        edge('e3', 'Builder', 'blocked', 'Deploy'),
      ],
    });

    // Approval must be guaranteed, not merely possible. One unapproved path to
    // a deploy is enough to make the workflow unsafe.
    expect(codes(validateGraphIR(ir))).toContain(DiagnosticCode.ProtectedEffectWithoutApproval);
  });

  it('rejects a required input artifact that nothing produces', () => {
    const ir = graph({
      nodes: [
        agent('Builder', 'builder', {
          inputs: [{ name: 'plan', artifactType: 'Plan', required: true, cardinality: 'one' }],
        }),
        human('Approval'),
      ],
      edges: [edge('e1', 'Builder', 'completed', 'Approval')],
      artifacts: [{ id: 'Plan', name: 'Plan' }],
    });

    expect(codes(validateGraphIR(ir))).toContain(DiagnosticCode.MissingArtifactProducer);
  });

  it('rejects a required artifact whose only producer runs after the consumer', () => {
    const ir = graph({
      nodes: [
        agent('Builder', 'builder', {
          inputs: [{ name: 'plan', artifactType: 'Plan', required: true, cardinality: 'one' }],
        }),
        agent('Planner', 'reviewer', {
          outputs: [{ name: 'plan', artifactType: 'Plan', required: true, cardinality: 'one' }],
        }),
        human('Approval'),
      ],
      edges: [
        edge('e1', 'Builder', 'completed', 'Planner'),
        edge('e2', 'Planner', 'completed', 'Approval'),
      ],
      artifacts: [{ id: 'Plan', name: 'Plan' }],
    });

    expect(codes(validateGraphIR(ir))).toContain(DiagnosticCode.MissingArtifactProducer);
  });

  it('rejects a blocking acceptance criterion with no usable verifier', () => {
    const base = bugFixGraph();
    const ir: GraphIR = {
      ...base,
      goals: [
        {
          id: 'g1',
          objective: 'fix the bug',
          riskClass: 'medium',
          criteria: [
            {
              id: 'c1',
              statement: 'tests pass',
              blocking: true,
              verifier: { nodeId: 'NoSuchNode' },
            },
          ],
        },
      ],
    };

    expect(codes(validateGraphIR(ir))).toContain(DiagnosticCode.BlockingCriterionHasNoVerifier);
  });

  it('rejects an undeclared secret read when policy denies it', () => {
    const base = bugFixGraph();
    const ir: GraphIR = {
      ...base,
      nodes: base.nodes.map((node) =>
        node.id === 'Builder' ? { ...node, annotations: { reads_secret: 'true' } } : node,
      ),
      policies: {
        ...base.policies,
        security: { denyUndeclaredNetwork: false, denyUndeclaredSecrets: true },
      },
    };

    expect(codes(validateGraphIR(ir))).toContain(DiagnosticCode.UndeclaredSecretAccess);
  });

  it('rejects an extension namespace the host does not understand', () => {
    const base = bugFixGraph();
    const ir: GraphIR = { ...base, extensions: { 'vendor.example/custom/v1': { a: 1 } } };

    // Silently ignoring it would let the document mean more than the host can
    // enforce.
    expect(codes(validateGraphIR(ir))).toContain(DiagnosticCode.UnsupportedExtension);
    expect(
      validateGraphIR(ir, { supportedExtensions: ['vendor.example/custom/v1'] }).filter(
        (d) => d.code === DiagnosticCode.UnsupportedExtension,
      ),
    ).toEqual([]);
  });

  it('rejects a required check that an accepted path can bypass', () => {
    const ir = graph({
      nodes: [agent('Builder', 'builder'), check('Tests'), human('Approval')],
      edges: [
        edge('e1', 'Builder', 'completed', 'Tests'),
        edge('e2', 'Tests', 'pass', 'Approval'),
        // Shortcut straight to acceptance.
        edge('e3', 'Builder', 'blocked', 'Approval'),
      ],
    });

    expect(codes(validateGraphIR(ir))).toContain(DiagnosticCode.RequiredCheckBypassable);
  });

  it('rejects a document from an incompatible IR major version', () => {
    const ir: GraphIR = { ...bugFixGraph(), irVersion: '2.0' };

    expect(codes(validateGraphIR(ir))).toContain(DiagnosticCode.UnsupportedIrVersion);
  });

  it('rejects duplicate node ids', () => {
    const ir = graph({
      nodes: [agent('A', 'reviewer'), agent('A', 'reviewer'), human('B')],
      edges: [edge('e1', 'A', 'completed', 'B')],
    });

    expect(codes(validateGraphIR(ir))).toContain(DiagnosticCode.DuplicateDeclaration);
  });

  it('rejects a node bound to a role that was never declared', () => {
    const ir = graph({
      nodes: [agent('A', 'ghost_role'), human('B')],
      edges: [edge('e1', 'A', 'completed', 'B')],
    });

    expect(codes(validateGraphIR(ir))).toContain(DiagnosticCode.UnknownRole);
  });
});

describe('Graph IR validator — warnings do not block execution', () => {
  it('warns about a retry that does not require new evidence, without failing', () => {
    const base = bugFixGraph();
    const ir: GraphIR = {
      ...base,
      loops: [
        { ...base.loops[0]!, policy: { ...base.loops[0]!.policy, requireNewEvidence: false } },
      ],
    };
    const diagnostics = validateGraphIR(ir);

    expect(diagnostics.map((d) => d.code)).toContain(DiagnosticCode.RetryWithoutNewEvidence);
    expect(isExecutable(diagnostics)).toBe(true);
  });

  it('warns when a looping workflow declares no cost ceiling', () => {
    const base = bugFixGraph();
    const ir: GraphIR = { ...base, policies: { ...base.policies, budget: undefined } };
    const diagnostics = validateGraphIR(ir);

    expect(diagnostics.map((d) => d.code)).toContain(DiagnosticCode.MissingCostBoundary);
    expect(isExecutable(diagnostics)).toBe(true);
  });
});
