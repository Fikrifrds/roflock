import { graphIrToWorkflowGraph } from '@roleflock/graph-core';
import type { GraphIR } from '@roleflock/graph-ir';
import { compile } from '@roleflock/language';
import { describe, expect, it } from 'vitest';
import { NodeFailure, runGraph, type NodeContext, type NodeResult } from './index.js';

/**
 * R3: a compiled `.roflock` workflow executing through the existing runtime.
 *
 * These are the acceptance tests for the whole language → IR → bridge → runtime
 * path. They deliberately use the real compiler and the real `runGraph` with a
 * fake deterministic executor, so nothing here proves anything about a
 * particular provider — only that the semantics survive the trip.
 */

function compileToRuntimeGraph(source: string) {
  const compiled = compile(source, { uri: 'test.roflock' });
  if (!compiled.ir) {
    throw new Error(
      `compile failed:\n${compiled.diagnostics.map((d) => `${d.code} ${d.message}`).join('\n')}`,
    );
  }
  return { ir: compiled.ir, bridged: graphIrToWorkflowGraph(compiled.ir) };
}

function graphOf(source: string) {
  const { bridged } = compileToRuntimeGraph(source);
  if (!bridged.graph) {
    throw new Error(
      `bridge failed:\n${bridged.diagnostics.map((d) => `${d.code} ${d.message}`).join('\n')}`,
    );
  }
  return bridged.graph;
}

/** Records what ran, in order, and lets a test script specific failures. */
function fakeExecutor(script: Record<string, Array<'ok' | 'fail'>> = {}) {
  const ran: string[] = [];
  const counts = new Map<string, number>();
  const execute = async (context: NodeContext) => {
    const id = context.node.id;
    ran.push(id);
    const attempt = (counts.get(id) ?? 0) + 1;
    counts.set(id, attempt);
    const outcome = script[id]?.[attempt - 1] ?? 'ok';
    if (outcome === 'fail') {
      throw new NodeFailure(`${id} verification failed`, 'verification_failed', {
        repairClass: 'test_failure',
      });
    }
    return id;
  };
  return { ran, execute, timesRun: (id: string) => counts.get(id) ?? 0 };
}

/** Approves every repair-envelope guard, as a permissive daemon would. */
const allowRepairs = { evaluateEdgeGuard: () => true };

const LINEAR = `
workflow Linear { version "1.0.0" }
role implementer { write }
agent Builder { role implementer objective "make the change" }
check Tests { run "npm test" required }
human Accept
flow {
  Builder -> Tests
  Tests.pass -> Accept
}
`;

const REPAIR_LOOP = `
workflow BugFix { version "1.0.0" max_cost 5 }
role implementer { write }
role critic { readonly }
agent Builder { role implementer objective "fix it" }
check Tests { run "npm test" required }
agent Reviewer { role critic objective "review it" }
human Accept
flow {
  Builder -> Tests
  Tests.pass -> Reviewer
  Tests.fail -> Builder { max 3 }
  Reviewer -> Accept
}
`;

describe('bridging compiled .roflock into the runtime graph', () => {
  it('maps a linear workflow onto dependency-ordered nodes', () => {
    const graph = graphOf(LINEAR);

    // Topological, not alphabetical: the runtime sorts a run's results by node
    // order, so a bug-fix run would otherwise report Accept before Builder.
    expect(graph.nodes.map((n) => n.id)).toEqual(['Builder', 'Tests', 'Accept']);
    expect(graph.nodes.find((n) => n.id === 'Tests')!.dependsOn).toEqual(['Builder']);
    expect(graph.nodes.find((n) => n.id === 'Accept')!.dependsOn).toEqual(['Tests']);
    expect(graph.nodes.find((n) => n.id === 'Builder')!.dependsOn).toEqual([]);
  });

  it('derives the legacy dispatch role from facts the IR already carries', () => {
    const graph = graphOf(REPAIR_LOOP);
    const role = (id: string) => graph.nodes.find((n) => n.id === id)!.role;

    // The orchestrator switches on these to decide provider routing, the
    // verification runner, or a human wait — so each must be right.
    expect(role('Builder')).toBe('writer');
    expect(role('Tests')).toBe('test');
    // Read-only and downstream of a check: judging that check's result.
    expect(role('Reviewer')).toBe('verifier');
    expect(role('Accept')).toBe('accept');
  });

  it('carries the writer lease and the required-check flag across', () => {
    const graph = graphOf(LINEAR);

    expect(graph.nodes.find((n) => n.id === 'Builder')!.writer).toBe(true);
    expect(graph.nodes.find((n) => n.id === 'Tests')!.required).toBe(true);
    expect(graph.nodes.filter((n) => n.writer)).toHaveLength(1);
  });

  it('maps a bounded loop to a typed failure edge behind the repair gate', () => {
    const graph = graphOf(REPAIR_LOOP);
    const repair = graph.edges.find((e) => e.from === 'Tests' && e.to === 'Builder')!;

    expect(repair.when).toBe('on_fail');
    // A failed check may not send unchanged work back through the writer unless
    // a repair-envelope policy says the repair is in scope.
    expect(repair.guard).toBe('repair_envelope');
  });

  it('converts an attempt budget into a re-entry ceiling without buying an extra attempt', () => {
    const graph = graphOf(REPAIR_LOOP);

    // `max 3` means three attempts, which is two re-entries. Setting the
    // ceiling to 3 would silently grant a fourth billable attempt.
    expect(graph.maxLoopIterations).toBe(2);
    expect(graph.nodes.find((n) => n.id === 'Builder')!.maxAttempts).toBe(3);
  });

  it('derives concurrency from the graph shape', () => {
    expect(graphOf(LINEAR).maxConcurrency).toBe(1);
  });
});

describe('executing compiled .roflock through runGraph', () => {
  it('runs a linear workflow to completion in dependency order', async () => {
    const executor = fakeExecutor();
    const result = await runGraph(graphOf(LINEAR), executor.execute);

    expect(result.state).toBe('completed');
    expect(executor.ran).toEqual(['Builder', 'Tests', 'Accept']);
  });

  it('routes a failed check back to the writer and completes after a repair', async () => {
    const executor = fakeExecutor({ Tests: ['fail', 'ok'] });
    const result = await runGraph(graphOf(REPAIR_LOOP), executor.execute, allowRepairs);

    expect(result.state).toBe('completed');
    expect(result.loopIterations).toBe(1);
    // The writer re-ran; the reviewer only ever saw a passing build.
    expect(executor.timesRun('Builder')).toBe(2);
    expect(executor.timesRun('Tests')).toBe(2);
    expect(executor.timesRun('Reviewer')).toBe(1);
  });

  it('stops at the loop ceiling instead of retrying forever', async () => {
    const executor = fakeExecutor({ Tests: ['fail', 'fail', 'fail', 'fail', 'fail'] });
    const result = await runGraph(graphOf(REPAIR_LOOP), executor.execute, allowRepairs);

    expect(result.state).toBe('failed');
    // Three attempts, as `max 3` says — not four.
    expect(executor.timesRun('Tests')).toBe(3);
    expect(result.results.find((r) => r.nodeId === 'Accept')?.status).toBe('skipped');
  });

  it('refuses the repair route when the envelope policy denies it', async () => {
    const executor = fakeExecutor({ Tests: ['fail', 'ok'] });
    const result = await runGraph(graphOf(REPAIR_LOOP), executor.execute, {
      evaluateEdgeGuard: () => false,
    });

    // Fails closed: an out-of-scope repair stops the run rather than sending
    // the writer back with authority nobody granted.
    expect(result.state).toBe('failed');
    expect(executor.timesRun('Builder')).toBe(1);
  });

  it('cannot reach acceptance without the required check passing', async () => {
    const executor = fakeExecutor({ Tests: ['fail', 'fail', 'fail', 'fail'] });
    const result = await runGraph(graphOf(REPAIR_LOOP), executor.execute, allowRepairs);
    const accept = result.results.find((r) => r.nodeId === 'Accept');

    expect(result.state).toBe('failed');
    expect(accept?.status).not.toBe('completed');
  });

  it('waits for the human gate rather than accepting on its own', async () => {
    const seen: string[] = [];
    const result = await runGraph(graphOf(LINEAR), async ({ node }) => {
      seen.push(node.id);
      if (node.role === 'accept') throw new NodeFailure('awaiting human', 'setup_required');
      return node.id;
    });

    // `setup_required` maps to no edge on purpose: the run stops at the gate so
    // it can resume there, instead of sending unchanged work back to the writer.
    expect(result.state).toBe('failed');
    expect(seen).toEqual(['Builder', 'Tests', 'Accept']);
    expect(result.results.find((r) => r.nodeId === 'Accept')?.failureClass).toBe('setup_required');
  });

  it('runs a parallel read-only branch concurrently while serialising the writer', async () => {
    const graph = graphOf(`
      workflow Parallel { version "1.0.0" }
      role implementer { write }
      role critic { readonly }
      agent Builder { role implementer objective "build" }
      check Tests { run "npm test" required }
      agent ReviewA { role critic objective "review correctness" }
      agent ReviewB { role critic objective "review scope" }
      human Accept
      flow {
        Builder -> Tests
        Tests.pass -> ReviewA
        Tests.pass -> ReviewB
        ReviewA -> Accept
        ReviewB -> Accept
      }
    `);

    expect(graph.maxConcurrency).toBe(2);

    let inFlight = 0;
    let peak = 0;
    let peakWriters = 0;
    let writersInFlight = 0;
    const result = await runGraph(graph, async ({ node }) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      if (node.writer) {
        writersInFlight += 1;
        peakWriters = Math.max(peakWriters, writersInFlight);
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (node.writer) writersInFlight -= 1;
      inFlight -= 1;
      return node.id;
    });

    expect(result.state).toBe('completed');
    expect(peak).toBe(2);
    expect(peakWriters).toBe(1);
  });

  it('enforces the artifact gate when a role opts into Role Protocol authority', async () => {
    // `authority executor` binds this role to the Role Protocol executor
    // profile and its artifact gate. Enforcement is always declared, never
    // inferred from what a role happens to be called.
    const graph = graphOf(`
      workflow Gated { version "1.0.0" }
      role executor { write authority executor }
      agent Build { role executor objective "execute the approved plan" }
      check Tests { run "npm test" required }
      human Accept
      flow {
        Build -> Tests
        Tests.pass -> Accept
      }
    `);

    expect(graph.nodes.find((n) => n.id === 'Build')!.authorityRole).toBe('executor');

    let started = false;
    await expect(
      runGraph(graph, async ({ node }) => {
        if (node.id === 'Build') started = true;
        return node.id;
      }),
    ).rejects.toThrow(/Artifact gate rejected Build at start/);

    // The gate fires before the node runs, so no provider work is paid for.
    expect(started).toBe(false);
  });

  it('leaves authorityRole unset for a role that is not a Role Protocol role', () => {
    const graph = graphOf(LINEAR);

    expect(graph.nodes.find((n) => n.id === 'Builder')!.authorityRole).toBeUndefined();
  });
});

describe('the bridge fails closed', () => {
  it('rejects a graph the runtime validator will not accept', () => {
    // Two concurrent writers: the IR validator catches this first, so reach the
    // bridge with hand-built IR that skipped compilation.
    const { ir } = compileToRuntimeGraph(LINEAR);
    const twoWriters: GraphIR = {
      ...ir,
      nodes: ir.nodes.map((node) =>
        node.id === 'Tests'
          ? ({
              ...node,
              kind: 'agent',
              roleRef: 'implementer',
              agent: { objective: 'also writes', mode: 'tool_loop' },
              effects: [{ class: 'workspace_write', risk: 'medium' }],
            } as GraphIR['nodes'][number])
          : node,
      ),
    };

    const result = graphIrToWorkflowGraph(twoWriters);

    expect(result.graph).toBeUndefined();
    expect(result.diagnostics.some((d) => d.message.includes('parallel writers'))).toBe(true);
  });

  it('refuses a node kind the current runtime cannot execute', () => {
    const { ir } = compileToRuntimeGraph(LINEAR);
    const withEvent: GraphIR = {
      ...ir,
      nodes: [
        ...ir.nodes,
        {
          id: 'Trigger',
          name: 'Trigger',
          kind: 'event',
          outcomes: [{ id: 'completed' }],
          event: { eventType: 'ticket.created' },
        },
      ],
    };

    const result = graphIrToWorkflowGraph(withEvent);

    // Better to refuse than to silently drop a node the author wrote.
    expect(result.graph).toBeUndefined();
    expect(result.diagnostics.some((d) => d.message.includes("kind 'event'"))).toBe(true);
  });
});

describe('semantic parity with the built-in bug-fix graph', () => {
  it('produces the same governing structure as the hard-coded template', () => {
    const bridged = graphOf(REPAIR_LOOP);

    // Not a shape-for-shape comparison — the built-in has parallel planners the
    // source does not. What must match is the governing structure: one writer,
    // a required check, a guarded repair route, and a terminal accept.
    expect(bridged.nodes.filter((n) => n.writer)).toHaveLength(1);
    expect(bridged.nodes.filter((n) => n.required).map((n) => n.role)).toEqual(['test']);
    expect(bridged.nodes.filter((n) => n.role === 'accept')).toHaveLength(1);
    expect(
      bridged.edges.filter((e) => e.when === 'on_fail' && e.guard === 'repair_envelope'),
    ).toHaveLength(1);
  });

  it('records results in dependency order like any other graph', async () => {
    const executor = fakeExecutor();
    const result = await runGraph(graphOf(REPAIR_LOOP), executor.execute, allowRepairs);
    const order = result.results.map((r: NodeResult) => r.nodeId);

    expect(result.state).toBe('completed');
    expect(order.indexOf('Builder')).toBeLessThan(order.indexOf('Tests'));
    expect(order.indexOf('Tests')).toBeLessThan(order.indexOf('Accept'));
  });
});
