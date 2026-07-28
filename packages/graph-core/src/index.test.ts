import { describe, expect, it } from 'vitest';
import {
  GRAPH_SCHEMA_VERSION,
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
    expect(bugFixGraph.edges).toContainEqual({ from: 'test', to: 'writer', when: 'on_fail' });
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
    expect(
      validateGraph(needsChangesToNonWriter).some((e) =>
        e.includes('routes on_needs_changes to non-writer'),
      ),
    ).toBe(true);
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
      'incompatible fallback: verifier verifier routes findings directly to executor writer',
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
    expect(recommendWorkflow({ type: 'bug_fix' }).mode).toBe('bug_fix');
    expect(recommendWorkflow({ type: 'investigation' }).mode).toBe('direct');
    expect(recommendWorkflow({ type: 'feature', risk: 'low' }).mode).toBe('fast');
    expect(recommendWorkflow({ type: 'feature', risk: 'medium' }).mode).toBe('standard');
    expect(recommendWorkflow({ type: 'new_product' }).mode).toBe('critical');
    expect(recommendWorkflow({ type: 'security_fix' }).mode).toBe('critical');
    // Direct mode must not drag in a reviewer the user did not ask for.
    expect(directGraph.nodes.some((n) => n.role === 'reviewer')).toBe(false);
  });
});
