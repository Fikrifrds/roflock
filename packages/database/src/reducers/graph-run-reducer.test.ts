import type { RuntimeEvent } from '@roleflock/contracts';
import { describe, expect, it } from 'vitest';
import { RuntimeHistoryError, projectGraphRun, reduceGraphRun } from './graph-run-reducer.js';

const AT = '2026-08-08T10:00:00.000Z';

function started(overrides: Partial<Extract<RuntimeEvent, { type: 'graph_run.started' }>> = {}) {
  return {
    type: 'graph_run.started' as const,
    runId: 'run_1',
    taskId: 'task_1',
    graphVersionId: 'bug_fix@3',
    resumedNodeIds: [],
    resumedLoopIterations: 0,
    at: AT,
    ...overrides,
  };
}

const nodeStarted = (nodeId: string, attempt = 1, loopIteration = 0): RuntimeEvent => ({
  type: 'node_run.started',
  runId: 'run_1',
  nodeId,
  attempt,
  loopIteration,
  at: AT,
});

const nodeSettled = (
  nodeId: string,
  outcome: 'completed' | 'failed' | 'unknown' = 'completed',
  attempt = 1,
): RuntimeEvent => ({
  type: 'node_run.settled',
  runId: 'run_1',
  nodeId,
  attempt,
  outcome,
  at: AT,
});

const reentered = (iteration: number, from: string, to: string): RuntimeEvent => ({
  type: 'loop.reentered',
  runId: 'run_1',
  iteration,
  from,
  to,
  failureClass: 'verification_failed',
  at: AT,
});

describe('projecting a graph run from its history', () => {
  it('starts running with nothing settled', () => {
    const run = projectGraphRun([started()])!;

    expect(run.state).toBe('running');
    expect(run.loopIterations).toBe(0);
    expect(run.nodes).toEqual([]);
  });

  it('records a node from start to settle', () => {
    const run = projectGraphRun([started(), nodeStarted('writer'), nodeSettled('writer')])!;

    expect(run.nodes).toEqual([
      { nodeId: 'writer', state: 'settled', attempt: 1, outcome: 'completed' },
    ]);
  });

  it('carries a failure classification through', () => {
    const run = projectGraphRun([
      started(),
      nodeStarted('test'),
      {
        type: 'node_run.settled',
        runId: 'run_1',
        nodeId: 'test',
        attempt: 1,
        outcome: 'failed',
        failureClass: 'verification_failed',
        at: AT,
      },
    ])!;

    expect(run.nodes[0]?.failureClass).toBe('verification_failed');
  });

  it('counts re-entries and discards what the loop invalidated', () => {
    const run = projectGraphRun([
      started(),
      nodeStarted('writer'),
      nodeSettled('writer'),
      nodeStarted('test'),
      nodeSettled('test', 'failed'),
      reentered(1, 'test', 'writer'),
    ])!;

    expect(run.loopIterations).toBe(1);
    // The writer's recorded result described code that is about to be rewritten,
    // so keeping it would make the projection claim work that no longer exists.
    expect(run.nodes.map((node) => node.nodeId)).toEqual(['test']);
  });

  it('inherits what a resumed run already spent', () => {
    const run = projectGraphRun([
      started({ resumedNodeIds: ['writer'], resumedLoopIterations: 2 }),
    ])!;

    // Starting at zero would hand the restarted task a fresh repair budget.
    expect(run.loopIterations).toBe(2);
    expect(run.nodes).toEqual([
      { nodeId: 'writer', state: 'settled', attempt: 0, outcome: 'completed' },
    ]);
  });

  it('settles the run with its reason', () => {
    const run = projectGraphRun([
      started(),
      {
        type: 'graph_run.settled',
        runId: 'run_1',
        outcome: 'interrupted',
        reason: 'outcome_unknown',
        at: AT,
      },
    ])!;

    expect(run.state).toBe('settled');
    expect(run.outcome).toBe('interrupted');
    expect(run.reason).toBe('outcome_unknown');
  });

  it('is deterministic', () => {
    const history = [
      started(),
      nodeStarted('writer'),
      nodeSettled('writer'),
      nodeStarted('test'),
      nodeSettled('test', 'failed'),
      reentered(1, 'test', 'writer'),
      nodeStarted('writer', 1),
      nodeSettled('writer'),
    ];

    // The same history must always describe the same run, or it is a log rather
    // than evidence.
    expect(projectGraphRun(history)).toEqual(projectGraphRun([...history]));
  });

  it('does not mutate the projection it was given', () => {
    const first = projectGraphRun([started(), nodeStarted('writer')])!;
    const snapshot = JSON.stringify(first);

    reduceGraphRun(first, nodeSettled('writer'));

    expect(JSON.stringify(first)).toBe(snapshot);
  });
});

describe('a contradictory history is refused, not repaired', () => {
  it('rejects an event before the run started', () => {
    // A projection that quietly invents the missing start would hide whatever
    // dropped it.
    expect(() => projectGraphRun([nodeStarted('writer')])).toThrow(RuntimeHistoryError);
  });

  it('rejects a run starting twice', () => {
    expect(() => projectGraphRun([started(), started()])).toThrow(/started twice/);
  });

  it('rejects a node settling without a start', () => {
    expect(() => projectGraphRun([started(), nodeSettled('writer')])).toThrow(
      /without a matching start/,
    );
  });

  it('rejects a node settling twice', () => {
    expect(() =>
      projectGraphRun([
        started(),
        nodeStarted('writer'),
        nodeSettled('writer'),
        nodeSettled('writer'),
      ]),
    ).toThrow(/without a matching start/);
  });

  it('rejects a gap in the re-entry count', () => {
    // A missing re-entry would understate what was already paid for, which is
    // exactly the error that costs money.
    expect(() => projectGraphRun([started(), reentered(2, 'test', 'writer')])).toThrow(
      /does not follow/,
    );
  });

  it('rejects a run settling twice', () => {
    const settle: RuntimeEvent = {
      type: 'graph_run.settled',
      runId: 'run_1',
      outcome: 'completed',
      at: AT,
    };

    expect(() => projectGraphRun([started(), settle, settle])).toThrow(/settled twice/);
  });
});
