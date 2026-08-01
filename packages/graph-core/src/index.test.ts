import { describe, expect, it } from 'vitest';
import {
  GRAPH_SCHEMA_VERSION,
  assuredGraph,
  bugFixGraph,
  criticalGraph,
  directGraph,
  fastGraph,
  getWorkflowGraph,
  graphVersionId,
  recommendWorkflow,
  standardGraph,
  validateGraph,
  type GraphNode,
  type WorkflowGraph,
} from './index.js';

function node(id: string, dependsOn: string[] = [], extra: Partial<GraphNode> = {}): GraphNode {
  return { id, role: 'writer', kind: 'agent', dependsOn, ...extra } as GraphNode;
}

function graph(nodes: GraphNode[], overrides: Partial<WorkflowGraph> = {}): WorkflowGraph {
  return {
    id: 'direct',
    version: graphVersionId('direct'),
    label: 'test',
    description: 'test',
    nodes,
    edges: [],
    maxConcurrency: 1,
    maxLoopIterations: 1,
    ...overrides,
  };
}

describe('workflow graphs', () => {
  it('validates bug_fix sequence', () => {
    expect(validateGraph(bugFixGraph)).toEqual([]);
    expect(bugFixGraph.nodes.map((n) => n.id)).toEqual([
      'planner',
      'planner_tests',
      'reviewer',
      'writer',
      'test',
      'verifier',
      'accept',
    ]);
    expect(bugFixGraph.maxConcurrency).toBe(2);
    expect(bugFixGraph.nodes.find((n) => n.id === 'reviewer')?.dependsOn).toEqual([
      'planner',
      'planner_tests',
    ]);
    expect(bugFixGraph.nodes.find((n) => n.id === 'planner')?.focus).not.toBe(
      bugFixGraph.nodes.find((n) => n.id === 'planner_tests')?.focus,
    );
  });

  it('exposes direct/fast/standard/critical modes', () => {
    expect(validateGraph(directGraph)).toEqual([]);
    expect(validateGraph(fastGraph)).toEqual([]);
    expect(validateGraph(standardGraph)).toEqual([]);
    expect(validateGraph(criticalGraph)).toEqual([]);
    expect(getWorkflowGraph('direct').nodes.map((n) => n.id)).toEqual(['writer', 'test', 'accept']);
    expect(getWorkflowGraph('fast').nodes[0]?.id).toBe('planner');
    expect(getWorkflowGraph('critical').id).toBe('critical');
  });

  it('pins a graph to an immutable version', () => {
    const current = getWorkflowGraph(`bug_fix@${GRAPH_SCHEMA_VERSION}`);
    const legacy = getWorkflowGraph('bug_fix@1');
    expect(current.id).toBe('bug_fix');
    expect(current.nodes.some((node) => node.id === 'planner_tests')).toBe(true);
    expect(legacy.nodes.some((node) => node.id === 'planner_tests')).toBe(false);
    expect(legacy.maxConcurrency).toBe(1);
    expect(validateGraph(legacy)).toEqual([]);
    expect(getWorkflowGraph('bug_fix@2').edges).toContainEqual({
      from: 'verifier',
      to: 'writer',
      when: 'on_needs_changes',
    });
    expect(current.edges).toContainEqual({
      from: 'verifier',
      to: 'planner',
      when: 'on_needs_changes',
    });
    expect(() => getWorkflowGraph('bug_fix@0')).toThrow(/no longer available/);
    expect(() => getWorkflowGraph('nonsense')).toThrow(/Unknown workflow mode/);
    // Every template carries its own version so a run can be replayed exactly.
    expect(bugFixGraph.version).toBe(`bug_fix@${GRAPH_SCHEMA_VERSION}`);
    expect(standardGraph.version).not.toBe(bugFixGraph.version);
  });

  it('rejects parallel writers, duplicates, and a missing accept node', () => {
    expect(
      validateGraph(
        graph([
          node('writer', [], { writer: true }),
          node('writer', [], { writer: true }),
          node('accept', ['writer'], { role: 'accept', kind: 'human_approval' }),
        ]),
      ),
    ).toEqual(expect.arrayContaining(['duplicate node id', 'parallel writers are not allowed']));

    expect(
      validateGraph(
        graph([node('writer', [], { writer: true }), node('test', ['writer'], { role: 'test' })]),
      ),
    ).toContain('graph requires a terminal accept node');
  });

  it('rejects an unbounded cycle but allows a bounded retry loop', () => {
    const unbounded = graph(
      [
        node('writer', ['test'], { writer: true }),
        node('test', ['writer'], { role: 'test' }),
        node('accept', ['test'], { role: 'accept', kind: 'human_approval' }),
      ],
      { edges: [{ from: 'test', to: 'writer', when: 'always' }] },
    );
    expect(validateGraph(unbounded).some((e) => e.includes('cycle'))).toBe(true);

    // The shipped templates loop test → writer, and that must stay legal.
    expect(validateGraph(bugFixGraph)).toEqual([]);
    expect(bugFixGraph.edges).toContainEqual({
      from: 'test',
      to: 'writer',
      when: 'on_fail',
      guard: 'repair_envelope',
    });
  });

  it('rejects a pass path that bypasses a required check', () => {
    const bypass = graph([
      node('writer', [], { writer: true }),
      node('test', ['writer'], { role: 'test', required: true }),
      node('accept', ['writer'], { role: 'accept', kind: 'human_approval' }),
    ]);
    expect(validateGraph(bypass)).toContain('accept can be reached without required check test');
  });

  it('rejects incompatible fallbacks', () => {
    const straightToAccept = graph(
      [
        node('writer', [], { writer: true, maxAttempts: 2 }),
        node('test', ['writer'], { role: 'test', required: true }),
        node('accept', ['test'], { role: 'accept', kind: 'human_approval' }),
      ],
      { edges: [{ from: 'test', to: 'accept', when: 'on_fail' }] },
    );
    expect(validateGraph(straightToAccept)).toContain(
      'incompatible fallback: test routes on_fail straight to accept',
    );

    const needsChangesToNonWriter = graph(
      [
        node('writer', [], { writer: true, maxAttempts: 2 }),
        node('test', ['writer'], { role: 'test', required: true }),
        node('verifier', ['test'], { role: 'verifier' }),
        node('accept', ['verifier'], { role: 'accept', kind: 'human_approval' }),
      ],
      { edges: [{ from: 'verifier', to: 'test', when: 'on_needs_changes' }] },
    );
    expect(validateGraph(needsChangesToNonWriter)).toContain(
      'incompatible fallback: verifier verifier must route findings to planner, not test',
    );
  });

  it('rejects an unguarded direct repair edge in current graphs', () => {
    const unsafe = graph(
      [
        node('writer', [], { writer: true, maxAttempts: 2 }),
        node('test', ['writer'], { role: 'test', required: true }),
        node('accept', ['test'], { role: 'accept', kind: 'human_approval' }),
      ],
      { edges: [{ from: 'test', to: 'writer', when: 'on_fail' }] },
    );
    expect(validateGraph(unsafe)).toContain(
      'incompatible fallback: test can repair through writer without repair_envelope',
    );
  });

  it('rejects authority roles that violate leases or bypass the planner', () => {
    const writerPlanner = graph([
      node('planner', [], {
        writer: true,
        role: 'planner',
        authorityRole: 'planner',
      }),
      node('accept', ['planner'], { role: 'accept', kind: 'human_approval' }),
    ]);
    expect(validateGraph(writerPlanner)).toContain(
      'planner gives writer authority to read-only role planner',
    );

    const verifierToExecutor = graph(
      [
        node('writer', [], {
          writer: true,
          authorityRole: 'executor',
          maxAttempts: 2,
        }),
        node('test', ['writer'], { role: 'test', required: true }),
        node('verifier', ['test'], {
          role: 'verifier',
          authorityRole: 'verifier',
        }),
        node('accept', ['verifier'], { role: 'accept', kind: 'human_approval' }),
      ],
      {
        edges: [{ from: 'verifier', to: 'writer', when: 'on_needs_changes' }],
      },
    );
    expect(validateGraph(verifierToExecutor)).toContain(
      'incompatible fallback: verifier verifier must route findings to planner, not writer',
    );
  });

  it('rejects invalid state references and non-finite budgets', () => {
    const bad = graph(
      [
        node('writer', [], { writer: true }),
        node('test', ['writer'], { role: 'test', required: true }),
        node('accept', ['test'], { role: 'accept', kind: 'human_approval' }),
      ],
      {
        edges: [{ from: 'ghost', to: 'writer', when: 'on_fail' }],
        maxConcurrency: 0,
        maxLoopIterations: Number.POSITIVE_INFINITY,
      },
    );
    const errors = validateGraph(bad);
    expect(errors).toContain('edge from unknown node ghost');
    expect(errors).toContain('maxConcurrency must be a finite integer >= 1');
    expect(errors).toContain('maxLoopIterations must be a finite integer >= 0');
  });

  it('recommends smallest sufficient modes from task intent', () => {
    expect(recommendWorkflow({ type: 'investigation' }).mode).toBe('direct');
    expect(recommendWorkflow({ type: 'feature', risk: 'low' }).mode).toBe('fast');
    expect(recommendWorkflow({ type: 'feature', risk: 'medium' }).mode).toBe('standard');
    // Direct mode must not drag in a reviewer the user did not ask for.
    expect(directGraph.nodes.some((n) => n.role === 'reviewer')).toBe(false);
  });

  it('recommends assurance for the work whose verdict has to be independent', () => {
    // These previously landed on bug_fix and critical, which verify through the
    // assurance chain only when the task happens to carry its inputs and fall
    // back to the writer's own check when it does not.
    expect(recommendWorkflow({ type: 'bug_fix' }).mode).toBe('assured');
    expect(recommendWorkflow({ type: 'new_product' }).mode).toBe('assured');
    expect(recommendWorkflow({ type: 'security_fix' }).mode).toBe('assured');
    expect(recommendWorkflow({ type: 'feature', risk: 'critical' }).mode).toBe('assured');
    expect(assuredGraph.requiresAssurance).toBe(true);
  });

  it('shapes the assured graph so it can deliver what its name claims', () => {
    expect(validateGraph(assuredGraph)).toEqual([]);
    expect(assuredGraph.nodes.find((n) => n.id === 'planner')?.authorityRole).toBe('planner');
    // The verifier's findings are planner work; routing them to the writer would
    // let the verifier prescribe an unapproved implementation.
    expect(
      assuredGraph.edges.some(
        (edge) => edge.from === 'verifier' && edge.when === 'on_needs_changes' && edge.to === 'planner',
      ),
    ).toBe(true);
  });

  it('rejects an assured graph that could reach acceptance without an independent verdict', () => {
    const withoutVerifier: WorkflowGraph = {
      ...assuredGraph,
      nodes: assuredGraph.nodes.filter((n) => n.role !== 'verifier'),
      edges: assuredGraph.edges.filter((e) => e.from !== 'verifier' && e.to !== 'verifier'),
    };
    expect(validateGraph(withoutVerifier)).toContain(
      'assured graph requires an independent verifier node',
    );

    const withoutPlannerAuthority: WorkflowGraph = {
      ...assuredGraph,
      nodes: assuredGraph.nodes.map((n) =>
        n.id === 'planner' ? { id: n.id, role: n.role, kind: n.kind, dependsOn: n.dependsOn } : n,
      ),
    };
    expect(validateGraph(withoutPlannerAuthority)).toContain(
      'assured graph requires a planner node holding planner authority',
    );
  });

  it('has no retained v1 or v2 shape to answer with', () => {
    // `assured` was introduced at the current schema version. Answering a stale
    // reference with v3 would silently change the graph a task started under.
    expect(() => getWorkflowGraph('assured@1')).toThrow();
    expect(() => getWorkflowGraph('assured@2')).toThrow();
    expect(getWorkflowGraph('assured').id).toBe('assured');
    expect(getWorkflowGraph(graphVersionId('assured')).requiresAssurance).toBe(true);
  });
});
