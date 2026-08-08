import { compile } from '@roleflock/language';
import type { GraphIR } from '@roleflock/graph-ir';
import { describe, expect, it } from 'vitest';
import { layoutGraph } from './layout.js';
import { toMermaid } from './mermaid.js';

const BUG_FIX = `
workflow BugFix { version "1.0.0" max_cost 5 }
role planner { readonly }
role builder { write }
role critic { readonly }
agent Plan { role planner objective "plan it" }
agent PlanTests { role planner objective "plan the tests" }
human Review { title "Approve the plan" }
agent Build { role builder objective "build it" retry 2 }
check Tests { run "npm test" required }
agent Verify { role critic objective "verify it" reviews }
human Accept
flow {
  Plan -> Review
  PlanTests -> Review
  Review -> Build
  Build -> Tests
  Tests.pass -> Verify
  Verify -> Accept
  Tests.fail -> Build { max 3 }
}
`;

function ir(source = BUG_FIX): GraphIR {
  const compiled = compile(source, { uri: 'x.roflock' });
  if (!compiled.ir) {
    throw new Error(compiled.diagnostics.map((d) => `${d.code} ${d.message}`).join('\n'));
  }
  return compiled.ir;
}

describe('laying out a workflow', () => {
  it('never draws a node above something it depends on', () => {
    const layout = layoutGraph(ir());
    const rank = (id: string) => layout.nodes.find((node) => node.id === id)!.rank;

    // Longest-path ranking, so the reviewer cannot appear before the planner it
    // waits for — a picture that got that wrong would be worse than none.
    expect(rank('Plan')).toBeLessThan(rank('Review'));
    expect(rank('PlanTests')).toBeLessThan(rank('Review'));
    expect(rank('Review')).toBeLessThan(rank('Build'));
    expect(rank('Build')).toBeLessThan(rank('Tests'));
    expect(rank('Tests')).toBeLessThan(rank('Accept'));
  });

  it('places parallel work side by side', () => {
    const layout = layoutGraph(ir());
    const plan = layout.nodes.find((node) => node.id === 'Plan')!;
    const planTests = layout.nodes.find((node) => node.id === 'PlanTests')!;

    expect(plan.rank).toBe(planTests.rank);
    expect([plan.order, planTests.order].sort()).toEqual([0, 1]);
  });

  it('is deterministic', () => {
    // A layout that shifted between renders would make a diagram useless for
    // spotting what changed.
    expect(layoutGraph(ir())).toEqual(layoutGraph(ir()));
  });

  it('marks the facts a reader needs at a glance', () => {
    const layout = layoutGraph(ir());
    const badges = (id: string) => layout.nodes.find((node) => node.id === id)!.badges;

    expect(badges('Build').writer).toBe(true);
    expect(badges('Tests').required).toBe(true);
    expect(badges('Review').human).toBe(true);
    expect(badges('Build').looping).toBe(true);
    expect(badges('Plan').looping).toBe(false);
  });

  it('distinguishes an accepted terminal from any other human gate', () => {
    const layout = layoutGraph(ir());

    expect(layout.nodes.find((node) => node.id === 'Accept')!.shape).toBe('terminal');
    // Mid-flow, so still a gate rather than the end.
    expect(layout.nodes.find((node) => node.id === 'Review')!.shape).toBe('human');
  });

  it('identifies a repair route as running backwards', () => {
    const layout = layoutGraph(ir());
    const repair = layout.edges.find((edge) => edge.from === 'Tests' && edge.to === 'Build')!;

    expect(repair.kind).toBe('failure');
    expect(repair.backwards).toBe(true);
    expect(layout.edges.find((edge) => edge.from === 'Build')!.backwards).toBe(false);
  });

  it('carries the guard a repair route must satisfy', () => {
    const layout = layoutGraph(ir());
    const repair = layout.edges.find((edge) => edge.from === 'Tests' && edge.to === 'Build')!;

    // The compiler does not yet emit policy guards, so this records the shape
    // rather than asserting a value the language cannot produce.
    expect(repair.guard).toBeUndefined();
  });

  it('surfaces the loop budget rather than leaving it in the source', () => {
    const layout = layoutGraph(ir());

    expect(layout.loops).toEqual([
      { id: 'loop1', nodeIds: ['Build', 'Tests'], maxAttempts: 3, verifierNodeId: 'Tests' },
    ]);
  });

  it('overlays live run state when given it', () => {
    const layout = layoutGraph(ir(), {
      state: {
        Build: { state: 'settled', outcome: 'completed' },
        Tests: { state: 'running' },
      },
    });

    expect(layout.nodes.find((node) => node.id === 'Build')).toMatchObject({
      state: 'settled',
      outcome: 'completed',
    });
    expect(layout.nodes.find((node) => node.id === 'Tests')?.state).toBe('running');
    // A node with no reported state stays unannotated rather than guessed at.
    expect(layout.nodes.find((node) => node.id === 'Accept')?.state).toBeUndefined();
  });
});

describe('rendering to mermaid', () => {
  it('draws every node and every edge', () => {
    const diagram = toMermaid(layoutGraph(ir()));

    for (const id of ['Plan', 'PlanTests', 'Review', 'Build', 'Tests', 'Verify', 'Accept']) {
      expect(diagram).toContain(id);
    }
    // A diagram that quietly omitted the repair route would misrepresent the
    // workflow's safety, which is the whole reason to draw it.
    expect(diagram).toContain('Tests -. "fail" .-> Build');
  });

  it('separates the happy path from failure routes visually', () => {
    const diagram = toMermaid(layoutGraph(ir()));

    expect(diagram).toContain('Build -- "completed" --> Tests');
    expect(diagram).toContain('.->');
  });

  it('gives a check a different shape from an agent', () => {
    const diagram = toMermaid(layoutGraph(ir()));

    expect(diagram).toContain('Tests{{');
    expect(diagram).toContain('Plan[');
    expect(diagram).toContain('Review[/');
    expect(diagram).toContain('Accept([');
  });

  it('labels the badges that change what a reader should conclude', () => {
    const diagram = toMermaid(layoutGraph(ir()));

    expect(diagram).toContain('writer');
    expect(diagram).toContain('required');
  });

  it('states the loop budget in the diagram', () => {
    const diagram = toMermaid(layoutGraph(ir()));

    expect(diagram).toContain('max 3 attempts');
    expect(diagram).toContain('verified by Tests');
  });

  it('produces a stable diagram for a stable document', () => {
    expect(toMermaid(layoutGraph(ir()))).toBe(toMermaid(layoutGraph(ir())));
  });

  it('sanitises ids that mermaid cannot take verbatim', () => {
    const layout = layoutGraph(ir());
    const withAwkwardId = {
      ...layout,
      nodes: [{ ...layout.nodes[0]!, id: 'my node.v2' }],
      edges: [],
      loops: [],
    };

    expect(toMermaid(withAwkwardId)).toContain('my_node_v2');
  });
});
