import { describe, expect, it } from 'vitest';
import {
  bugFixGraph,
  directGraph,
  graphVersionId,
  type GraphNode,
  type WorkflowGraph,
} from '@roleflock/graph-core';
import { NodeFailure, classifyFailure, runGraph } from './index.js';

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
    const result = await runGraph(bugFixGraph, async ({ node: n }) => {
      visited.push(n.id);
      if (n.id !== 'test') return n.id;
      testRuns += 1;
      if (testRuns === 1)
        throw new NodeFailure('Verification failed (npm test)', 'verification_failed');
      return 'green';
    });

    expect(result.state).toBe('completed');
    expect(result.loopIterations).toBe(1);
    // The writer re-runs, and so does everything downstream of it.
    expect(visited.filter((id) => id === 'writer')).toHaveLength(2);
    expect(visited.filter((id) => id === 'test')).toHaveLength(2);
    expect(visited.filter((id) => id === 'planner')).toHaveLength(1);
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
      { resumeCompleted: ['planner', 'reviewer', 'writer'] },
    );

    expect(visited).toEqual(['test', 'verifier', 'accept']);
    expect(result.state).toBe('completed');
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
