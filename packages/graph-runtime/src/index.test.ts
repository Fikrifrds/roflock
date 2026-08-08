import { describe, expect, it } from 'vitest';
import {
  bugFixGraph,
  directGraph,
  graphVersionId,
  type GraphNode,
  type WorkflowGraph,
} from '@roleflock/graph-core';
import { ArtifactGateError, NodeFailure, classifyFailure, runGraph } from './index.js';

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
    maxLoopIterations: 2,
    ...overrides,
  };
}

describe('graph runtime', () => {
  it('does not schedule an executor without exact approved input artifacts', async () => {
    const assured = graph([
      node('executor', [], {
        writer: true,
        authorityRole: 'executor',
      }),
      node('accept', ['executor'], { role: 'accept', kind: 'human_approval' }),
    ]);
    let invoked = false;

    await expect(
      runGraph(assured, async () => {
        invoked = true;
      }),
    ).rejects.toMatchObject({
      name: 'ArtifactGateError',
      nodeId: 'executor',
      phase: 'start',
      violation: { code: 'REQUIRED_INPUT_MISSING' },
    });
    expect(invoked).toBe(false);
  });

  it('pins an executor to current inputs and validates its report output', async () => {
    const assured = graph([
      node('executor', [], {
        writer: true,
        authorityRole: 'executor',
      }),
      node('accept', ['executor'], { role: 'accept', kind: 'human_approval' }),
    ]);
    const initialArtifacts = [
      {
        id: 'contract_1',
        kind: 'change_contract' as const,
        status: 'authorised',
        hash: 'a'.repeat(64),
        valid: true,
        current: true,
      },
      {
        id: 'plan_1',
        kind: 'execution_plan' as const,
        status: 'approved',
        hash: 'b'.repeat(64),
        valid: true,
        current: true,
      },
      {
        id: 'verification_1',
        kind: 'verification_specification' as const,
        status: 'approved',
        hash: 'c'.repeat(64),
        valid: true,
        current: true,
      },
    ];
    const result = await runGraph(
      assured,
      async ({ node: current }) =>
        current.id === 'executor'
          ? {
              artifacts: [
                {
                  id: 'report_1',
                  kind: 'execution_report' as const,
                  hash: 'd'.repeat(64),
                  valid: true,
                  current: true,
                },
              ],
            }
          : current.id,
      { initialArtifacts },
    );
    expect(result.state).toBe('completed');

    const invalid = await runGraph(
      assured,
      async ({ node: current }) => (current.id === 'executor' ? { artifacts: [] } : current.id),
      { initialArtifacts },
    );
    expect(invalid.state).toBe('failed');
    expect(invalid.results[0]?.error).toBeInstanceOf(ArtifactGateError);
  });

  it('does not route setup requirements back through the writer', async () => {
    const ran: string[] = [];
    const result = await runGraph(bugFixGraph, async ({ node: current }) => {
      ran.push(current.id);
      if (current.id === 'test') {
        throw new NodeFailure('Verification command required', 'setup_required');
      }
    });

    expect(ran.filter((id) => id === 'writer')).toHaveLength(1);
    expect(ran.filter((id) => id === 'test')).toHaveLength(1);
    expect(result.results.find((item) => item.nodeId === 'test')?.failureClass).toBe(
      'setup_required',
    );
  });

  it('runs a dependency-ordered graph to completion', async () => {
    const order: string[] = [];
    const result = await runGraph(directGraph, async ({ node: n }) => {
      order.push(n.id);
      return n.id;
    });

    expect(order).toEqual(['writer', 'test', 'accept']);
    expect(result.state).toBe('completed');
    expect(result.results.every((r) => r.status === 'completed')).toBe(true);
  });

  it('rejects an invalid graph before executing anything', async () => {
    let ran = false;
    await expect(
      runGraph(graph([node('writer', [], { writer: true })]), async () => {
        ran = true;
      }),
    ).rejects.toThrow(/Invalid graph/);
    expect(ran).toBe(false);
  });

  it('spends a local retry budget before failing a node', async () => {
    const attempts: number[] = [];
    const result = await runGraph(directGraph, async ({ node: n, attempt }) => {
      if (n.id !== 'writer') return n.id;
      attempts.push(attempt);
      if (attempt < 2) throw new Error('transient provider error');
      return 'written';
    });

    expect(attempts).toEqual([1, 2]);
    expect(result.state).toBe('completed');
    expect(result.loopIterations).toBe(0);
  });

  it('routes a failed deterministic check back to the writer', async () => {
    const visited: string[] = [];
    let testRuns = 0;
    const result = await runGraph(
      bugFixGraph,
      async ({ node: n }) => {
        visited.push(n.id);
        if (n.id !== 'test') return n.id;
        testRuns += 1;
        if (testRuns === 1)
          throw new NodeFailure('Verification failed (npm test)', 'verification_failed');
        return 'green';
      },
      {
        evaluateEdgeGuard: ({ edge }) => edge.guard === 'repair_envelope',
      },
    );

    expect(result.state).toBe('completed');
    expect(result.loopIterations).toBe(1);
    // The writer re-runs, and so does everything downstream of it.
    expect(visited.filter((id) => id === 'writer')).toHaveLength(2);
    expect(visited.filter((id) => id === 'test')).toHaveLength(2);
    expect(visited.filter((id) => id === 'planner')).toHaveLength(1);
  });

  it('routes a non-repairable deterministic failure to planner', async () => {
    const visited: string[] = [];
    let testRuns = 0;
    const result = await runGraph(
      bugFixGraph,
      async ({ node: current }) => {
        visited.push(current.id);
        if (current.id === 'test' && ++testRuns === 1) {
          throw new NodeFailure('Business assertion failed', 'verification_failed');
        }
        return current.id;
      },
      { evaluateEdgeGuard: () => false },
    );

    expect(result.state).toBe('completed');
    expect(visited.filter((id) => id === 'planner')).toHaveLength(2);
    expect(visited.filter((id) => id === 'writer')).toHaveLength(2);
  });

  it('routes a verifier rejection through planner before another execution', async () => {
    const visited: string[] = [];
    let rejections = 0;
    const result = await runGraph(bugFixGraph, async ({ node: n }) => {
      visited.push(n.id);
      if (n.id !== 'verifier') return n.id;
      rejections += 1;
      if (rejections === 1) {
        throw new NodeFailure('Verifier requested changes: missing null check', 'needs_changes');
      }
      return 'approved';
    });

    expect(result.state).toBe('completed');
    expect(result.loopIterations).toBe(1);
    expect(visited.filter((id) => id === 'planner')).toHaveLength(2);
    expect(visited.filter((id) => id === 'writer')).toHaveLength(2);
    // Accept may only run after the second verifier pass.
    expect(visited.lastIndexOf('accept')).toBeGreaterThan(visited.lastIndexOf('verifier'));
    expect(visited.filter((id) => id === 'accept')).toHaveLength(1);
  });

  it('a required deterministic failure blocks acceptance', async () => {
    const visited: string[] = [];
    const result = await runGraph(directGraph, async ({ node: n }) => {
      visited.push(n.id);
      if (n.id === 'test') throw new NodeFailure('Verification failed', 'verification_failed');
      return n.id;
    });

    expect(result.state).toBe('failed');
    expect(visited).not.toContain('accept');
    expect(result.results.find((r) => r.nodeId === 'accept')?.status).toBe('skipped');
    expect(result.results.find((r) => r.nodeId === 'test')?.failureClass).toBe(
      'verification_failed',
    );
  });

  it('stops looping once the loop budget is exhausted', async () => {
    let writes = 0;
    const result = await runGraph(bugFixGraph, async ({ node: n }) => {
      if (n.id === 'writer') writes += 1;
      if (n.id === 'test') throw new NodeFailure('Verification failed', 'verification_failed');
      return n.id;
    });

    expect(result.state).toBe('failed');
    expect(result.loopIterations).toBe(bugFixGraph.maxLoopIterations);
    // One initial pass plus one re-entry per loop iteration — never unbounded.
    expect(writes).toBe(bugFixGraph.maxLoopIterations + 1);
  });

  it('resets everything downstream of a loop target so a re-run is not partly stale', async () => {
    // writer → probe → gate → test → accept, with gate routing failures back to
    // the writer. `probe` completed before the loop re-entry, so a re-run that
    // kept its old result would report evidence gathered against code that no
    // longer exists.
    const looping = graph(
      [
        node('writer', [], { writer: true, maxAttempts: 2 }),
        node('probe', ['writer'], { role: 'planner' }),
        node('gate', ['probe'], { role: 'verifier' }),
        node('test', ['gate'], { role: 'test', required: true }),
        node('accept', ['test'], { role: 'accept', kind: 'human_approval' }),
      ],
      {
        edges: [
          { from: 'writer', to: 'probe', when: 'always' },
          { from: 'probe', to: 'gate', when: 'always' },
          { from: 'gate', to: 'test', when: 'always' },
          { from: 'test', to: 'accept', when: 'always' },
          { from: 'gate', to: 'writer', when: 'on_fail' },
        ],
      },
    );

    const runsPerNode = new Map<string, number>();
    const observedAttempts: number[] = [];

    const result = await runGraph(looping, async ({ node: n, attempt }) => {
      const run = (runsPerNode.get(n.id) ?? 0) + 1;
      runsPerNode.set(n.id, run);
      if (n.id === 'probe') observedAttempts.push(attempt);
      if (n.id === 'gate' && run === 1) throw new NodeFailure('needs work', 'verification_failed');
      return `${n.id}:${run}`;
    });

    expect(result.state).toBe('completed');
    expect(result.loopIterations).toBe(1);

    // The descendant re-ran rather than staying completed from the first pass.
    expect(runsPerNode.get('probe')).toBe(2);

    // Its stale result was discarded, not kept alongside the fresh one.
    const probeResults = result.results.filter((r) => r.nodeId === 'probe');
    expect(probeResults).toHaveLength(1);
    expect(probeResults[0]?.output).toBe('probe:2');

    // Attempt counters reset with the state, so the re-run is attempt 1 again
    // and does not silently consume the node's retry budget.
    expect(observedAttempts).toEqual([1, 1]);
    expect(probeResults[0]?.attempt).toBe(1);

    // Nodes downstream of the failure only ever ran after the loop settled.
    expect(runsPerNode.get('test')).toBe(1);
    expect(runsPerNode.get('accept')).toBe(1);
  });

  it('never schedules two writers at once', async () => {
    const parallel = graph(
      [
        node('writer', [], { writer: true }),
        node('sibling', [], { role: 'planner' }),
        node('test', ['writer', 'sibling'], { role: 'test', required: true }),
        node('accept', ['test'], { role: 'accept', kind: 'human_approval' }),
      ],
      { maxConcurrency: 4 },
    );

    let inFlightWriters = 0;
    let peakWriters = 0;
    let peakConcurrency = 0;
    let inFlight = 0;

    await runGraph(parallel, async ({ node: n }) => {
      inFlight += 1;
      peakConcurrency = Math.max(peakConcurrency, inFlight);
      if (n.writer) {
        inFlightWriters += 1;
        peakWriters = Math.max(peakWriters, inFlightWriters);
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (n.writer) inFlightWriters -= 1;
      inFlight -= 1;
      return n.id;
    });

    expect(peakWriters).toBe(1);
    expect(peakConcurrency).toBeGreaterThan(1);
  });

  it('honours the concurrency cap', async () => {
    const wide = graph(
      [
        node('a', [], { role: 'planner' }),
        node('b', [], { role: 'planner' }),
        node('c', [], { role: 'planner' }),
        node('writer', ['a', 'b', 'c'], { writer: true }),
        node('test', ['writer'], { role: 'test', required: true }),
        node('accept', ['test'], { role: 'accept', kind: 'human_approval' }),
      ],
      { maxConcurrency: 2 },
    );

    let inFlight = 0;
    let peak = 0;
    await runGraph(wide, async ({ node: n }) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return n.id;
    });

    expect(peak).toBe(2);
  });

  it('resumes from previously completed nodes after a restart', async () => {
    const visited: string[] = [];
    const result = await runGraph(
      bugFixGraph,
      async ({ node: n }) => {
        visited.push(n.id);
        return n.id;
      },
      { resumeCompleted: ['planner', 'planner_tests', 'reviewer', 'writer'] },
    );

    expect(visited).toEqual(['test', 'verifier', 'accept']);
    expect(result.state).toBe('completed');
  });

  it('keeps a completed parallel sibling honest when another sibling fails', async () => {
    const parallel = graph(
      [
        node('planner_code', [], { role: 'planner' }),
        node('planner_tests', [], { role: 'planner' }),
        node('writer', ['planner_code', 'planner_tests'], { writer: true }),
        node('test', ['writer'], { role: 'test', required: true }),
        node('accept', ['test'], { role: 'accept', kind: 'human_approval' }),
      ],
      { maxConcurrency: 2 },
    );

    const result = await runGraph(parallel, async ({ node: n }) => {
      if (n.id === 'planner_code') throw new Error('provider invocation failed');
      if (n.id === 'planner_tests') {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return 'regression plan';
      }
      return n.id;
    });

    expect(result.state).toBe('failed');
    expect(result.results.find((entry) => entry.nodeId === 'planner_code')?.status).toBe('failed');
    expect(result.results.find((entry) => entry.nodeId === 'planner_tests')).toMatchObject({
      status: 'completed',
      output: 'regression plan',
    });
    expect(result.results.find((entry) => entry.nodeId === 'writer')?.status).toBe('skipped');
  });

  it('reports node state transitions for the run view', async () => {
    const transitions: Array<[string, string]> = [];
    await runGraph(directGraph, async ({ node: n }) => n.id, {
      onNodeState: (id, state) => transitions.push([id, state]),
    });

    expect(transitions).toContainEqual(['writer', 'running']);
    expect(transitions).toContainEqual(['writer', 'completed']);
    expect(transitions.at(-1)).toEqual(['accept', 'completed']);
  });

  it('stops on cancellation without routing', async () => {
    const controller = new AbortController();
    const result = await runGraph(
      directGraph,
      async ({ node: n }) => {
        if (n.id === 'writer') {
          controller.abort();
          throw new NodeFailure('Cancelled by operator', 'cancelled');
        }
        return n.id;
      },
      { signal: controller.signal },
    );

    expect(result.state).toBe('failed');
    expect(result.loopIterations).toBe(0);
  });

  it('classifies failures so they route to the right node class', () => {
    expect(classifyFailure(new NodeFailure('x', 'needs_changes'))).toBe('needs_changes');
    expect(classifyFailure(new Error('Verification failed (npm test)'))).toBe(
      'verification_failed',
    );
    expect(classifyFailure(new Error('Provider invocation timed out after 300000ms'))).toBe(
      'timeout',
    );
    expect(classifyFailure(new Error('Task budget exhausted'))).toBe('budget_exhausted');
    expect(classifyFailure(new Error('Cancelled by operator'))).toBe('cancelled');
    expect(classifyFailure('not an error')).toBe('unknown');
  });
});
