import { readFileSync } from 'node:fs';
import {
  getWorkflowGraph,
  graphIrToWorkflowGraph,
  type WorkflowGraph,
} from '@roleflock/graph-core';
import { compile } from '@roleflock/language';
import { describe, expect, it } from 'vitest';
import { NodeFailure, runGraph, type NodeContext } from './index.js';

/**
 * R4: the built-in workflows, expressed as `.roflock` source.
 *
 * These prove that `workflows/*.roflock` compile to graphs that govern
 * execution the same way the hard-coded TypeScript templates do. Until that
 * holds, the templates cannot become source, because a task started on the
 * compiled version would silently get different guarantees from one started on
 * the built-in.
 */

const MODES = ['direct', 'fast', 'bug_fix', 'standard', 'critical'] as const;

function compiledGraph(mode: string): WorkflowGraph {
  const source = readFileSync(
    new URL(`../../../workflows/${mode}.roflock`, import.meta.url),
    'utf8',
  );
  const compiled = compile(source, { uri: `workflows/${mode}.roflock` });
  if (!compiled.ir) {
    throw new Error(
      `${mode} did not compile:\n${compiled.diagnostics.map((d) => `${d.code} ${d.message}`).join('\n')}`,
    );
  }
  const bridged = graphIrToWorkflowGraph(compiled.ir);
  if (!bridged.graph) {
    throw new Error(
      `${mode} did not bridge:\n${bridged.diagnostics.map((d) => d.message).join('\n')}`,
    );
  }
  return bridged.graph;
}

/**
 * The properties that decide how a run is governed.
 *
 * Excludes `label` and `description`, which are display copy. Includes whether
 * a node carries a `focus`, because the runtime injects that into the prompt as
 * a swarm assignment — so a compiled graph that hands one to a node the
 * built-in leaves alone is sending a different prompt, not just different
 * wording. The text itself is not compared; its presence is.
 */
function governingShape(graph: WorkflowGraph) {
  return {
    maxConcurrency: graph.maxConcurrency,
    maxLoopIterations: graph.maxLoopIterations,
    nodes: [...graph.nodes]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((node) => ({
        id: node.id,
        role: node.role,
        kind: node.kind,
        dependsOn: [...node.dependsOn].sort(),
        writer: node.writer ?? false,
        required: node.required ?? false,
        maxAttempts: node.maxAttempts ?? null,
        // Included because leaving it out once let a real divergence pass: the
        // compiled graphs briefly gated nodes the built-ins do not.
        authorityRole: node.authorityRole ?? null,
        hasFocus: node.focus !== undefined,
      })),
    failureRoutes: graph.edges
      .filter((edge) => edge.when !== 'always')
      .map(
        (edge) => `${edge.from} --${edge.when}${edge.guard ? `/${edge.guard}` : ''}--> ${edge.to}`,
      )
      .sort(),
  };
}

describe.each(MODES)('%s workflow parity', (mode) => {
  it('compiles to the same governing shape as the built-in template', () => {
    expect(governingShape(compiledGraph(mode))).toEqual(governingShape(getWorkflowGraph(mode)));
  });
});

describe('what parity actually pins', () => {
  it('keeps one writer, a required check, and a terminal accept in every workflow', () => {
    for (const mode of MODES) {
      const graph = compiledGraph(mode);

      expect(graph.nodes.filter((n) => n.writer)).toHaveLength(1);
      expect(graph.nodes.filter((n) => n.required)).toHaveLength(1);
      expect(graph.nodes.filter((n) => n.role === 'accept')).toHaveLength(1);
    }
  });

  it('puts the repair route behind the envelope guard in every workflow', () => {
    for (const mode of MODES) {
      const repairs = compiledGraph(mode).edges.filter(
        (edge) => edge.when === 'on_fail' && edge.to === 'writer',
      );

      expect(repairs).toHaveLength(1);
      expect(repairs[0]!.guard).toBe('repair_envelope');
    }
  });

  it('gives the writer a local retry budget without inflating it from the loop', () => {
    for (const mode of MODES) {
      const graph = compiledGraph(mode);
      const writer = graph.nodes.find((n) => n.writer)!;

      // `retry 2` is the node's own budget. A planner that merely sits inside
      // the same repair loop must not inherit the loop's wider budget.
      expect(writer.maxAttempts).toBe(2);
      for (const node of graph.nodes) {
        if (node.id === 'writer') continue;
        expect(node.maxAttempts).toBeUndefined();
      }
    }
  });

  it('widens only the loop ceiling for critical work', () => {
    // Elevated risk buys more attempts at getting it right, not fewer gates.
    expect(compiledGraph('critical').maxLoopIterations).toBe(4);
    expect(compiledGraph('bug_fix').maxLoopIterations).toBe(3);
    expect(compiledGraph('direct').maxLoopIterations).toBe(2);
    expect(governingShape(compiledGraph('critical')).nodes).toEqual(
      governingShape(compiledGraph('bug_fix')).nodes,
    );
  });

  it('routes verifier findings to planning, never straight back to the writer', () => {
    for (const mode of ['bug_fix', 'standard', 'critical']) {
      const changes = compiledGraph(mode).edges.filter((e) => e.when === 'on_needs_changes');

      // A rejected change should be re-thought, not merely re-typed.
      expect(changes).toHaveLength(1);
      expect(changes[0]!.from).toBe('verifier');
      expect(changes[0]!.to).toBe('planner');
    }
  });

  it('plans in parallel only where the built-in does', () => {
    expect(compiledGraph('direct').maxConcurrency).toBe(1);
    expect(compiledGraph('fast').maxConcurrency).toBe(1);
    expect(compiledGraph('bug_fix').maxConcurrency).toBe(2);
  });
});

describe('compiled and built-in graphs execute the same way', () => {
  function trace(script: Record<string, Array<'ok' | 'fail'>> = {}) {
    const counts = new Map<string, number>();
    const execute = async (context: NodeContext) => {
      const id = context.node.id;
      const attempt = (counts.get(id) ?? 0) + 1;
      counts.set(id, attempt);
      if ((script[id]?.[attempt - 1] ?? 'ok') === 'fail') {
        throw new NodeFailure(`${id} failed`, 'verification_failed', { repairClass: 'test' });
      }
      return id;
    };
    return { execute, counts };
  }

  it.each(MODES)('%s completes identically on the happy path', async (mode) => {
    const fromSource = trace();
    const fromBuiltIn = trace();
    const options = { evaluateEdgeGuard: () => true };

    const a = await runGraph(compiledGraph(mode), fromSource.execute, options);
    const b = await runGraph(getWorkflowGraph(mode), fromBuiltIn.execute, options);

    expect(a.state).toBe('completed');
    expect(a.state).toBe(b.state);
    expect([...fromSource.counts.entries()].sort()).toEqual(
      [...fromBuiltIn.counts.entries()].sort(),
    );
  });

  it.each(MODES)('%s exhausts its repair loop identically', async (mode) => {
    const always = ['fail', 'fail', 'fail', 'fail', 'fail', 'fail'] as Array<'fail'>;
    const fromSource = trace({ test: always });
    const fromBuiltIn = trace({ test: always });
    const options = { evaluateEdgeGuard: () => true };

    const a = await runGraph(compiledGraph(mode), fromSource.execute, options);
    const b = await runGraph(getWorkflowGraph(mode), fromBuiltIn.execute, options);

    expect(a.state).toBe('failed');
    expect(a.loopIterations).toBe(b.loopIterations);
    // The number of billable writer invocations must match exactly — this is
    // where an off-by-one in the loop mapping would show up as real money.
    expect(fromSource.counts.get('writer')).toBe(fromBuiltIn.counts.get('writer'));
    expect(fromSource.counts.get('test')).toBe(fromBuiltIn.counts.get('test'));
  });
});

describe('historical graph versions stay resolvable', () => {
  it.each(MODES)('still serves %s@1 and %s@2 with their original semantics', (mode) => {
    const v1 = getWorkflowGraph(`${mode}@1`);
    const v2 = getWorkflowGraph(`${mode}@2`);
    const v3 = getWorkflowGraph(mode);

    expect(v1.version).toBe(`${mode}@1`);
    expect(v2.version).toBe(`${mode}@2`);
    // A task pinned to an older version must keep the graph it started with.
    // v1 predates the repair-envelope guard, so its repair route is unguarded.
    expect(v1.edges.some((e) => e.when === 'on_fail' && e.guard === undefined)).toBe(true);
    expect(v3.edges.some((e) => e.when === 'on_fail' && e.guard === 'repair_envelope')).toBe(true);
  });

  it('refuses a version it can no longer reproduce rather than substituting one', () => {
    expect(() => getWorkflowGraph('bug_fix@99')).toThrow(/no longer available/);
  });
});
