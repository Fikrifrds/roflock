import { stableInvocationKey } from '@roleflock/contracts';
import { classifyFailure, NodeFailure, runGraph } from '@roleflock/graph-runtime';
import { getWorkflowGraph } from '@roleflock/graph-core';
import { OUTCOME_UNKNOWN } from '@roleflock/run-control';
import { describe, expect, it } from 'vitest';
import { isUnresolvedBillableTurn } from '../src/services/orchestrator.js';

/**
 * ADR-010: a billable invocation whose result nobody observed requires a human
 * decision. It must not be repeated on a guess, and it must not be treated as
 * having failed.
 */

// The orchestrator's own rule, imported rather than restated — a copy here
// could agree with itself while disagreeing with what actually runs.
const unresolvedBillable = isUnresolvedBillableTurn;

const provider = { providerConnectionId: 'codex' };

describe('deciding whether a recorded turn may be repeated', () => {
  it.each([
    ['an outcome nobody recorded', { status: 'running', ...provider }],
    ['an explicitly unknown outcome', { status: 'unknown', outcome: OUTCOME_UNKNOWN, ...provider }],
    [
      'a turn cut short by a restart',
      { status: 'interrupted', outcome: 'interrupted', ...provider },
    ],
  ])('refuses to repeat %s', (_label, record) => {
    expect(unresolvedBillable(record)).toBe(true);
  });

  it.each([
    ['completed', { status: 'completed', outcome: 'completed', ...provider }],
    ['failed', { status: 'failed', outcome: 'failed', ...provider }],
  ])('allows the graph to decide when the outcome is %s', (_label, record) => {
    // A known outcome is not this decision. The graph's retry budget already
    // governs what happens after a definite failure.
    expect(unresolvedBillable(record)).toBe(false);
  });

  it('repeats a deterministic check freely', () => {
    // Nothing was billed, so re-running is strictly better than stopping the
    // run to ask a human about it.
    expect(
      unresolvedBillable({
        status: 'unknown',
        outcome: OUTCOME_UNKNOWN,
        providerConnectionId: 'deterministic',
      }),
    ).toBe(false);
  });
});

describe('an unknown outcome stops the run where it stands', () => {
  it('is classified as its own failure class', () => {
    expect(classifyFailure(new NodeFailure('unresolved', 'outcome_unknown'))).toBe(
      'outcome_unknown',
    );
  });

  it('routes nowhere, so no edge can carry it past the gate', async () => {
    const graph = getWorkflowGraph('direct');
    let writerRuns = 0;

    const result = await runGraph(
      graph,
      async ({ node }) => {
        if (node.id === 'writer') writerRuns += 1;
        if (node.id === 'test') {
          throw new NodeFailure('previous turn unresolved', 'outcome_unknown');
        }
        return node.id;
      },
      { evaluateEdgeGuard: () => true },
    );

    expect(result.state).toBe('failed');
    expect(result.results.find((r) => r.nodeId === 'test')?.failureClass).toBe('outcome_unknown');
    // The graph has a repair edge from test back to writer. An unknown outcome
    // must not take it: repeating might pay twice, skipping might discard work
    // that succeeded, and the runtime cannot tell which.
    expect(writerRuns).toBe(1);
    expect(result.loopIterations).toBe(0);
  });

  it('leaves confirmed nodes intact so the run can resume once resolved', async () => {
    const result = await runGraph(
      getWorkflowGraph('direct'),
      async ({ node }) => {
        if (node.id === 'test') throw new NodeFailure('unresolved', 'outcome_unknown');
        return node.id;
      },
      { evaluateEdgeGuard: () => true },
    );

    expect(result.results.find((r) => r.nodeId === 'writer')?.status).toBe('completed');
  });
});

describe('the identity that makes the check possible', () => {
  it('recognises the same turn after a restart', () => {
    const identity = {
      taskId: 'task_1',
      graphVersionId: 'direct@3',
      nodeId: 'writer',
      attempt: 1,
      loopIteration: 0,
    };

    // Different process, same key — which is the only reason the resumed run
    // can find the record at all.
    expect(stableInvocationKey(identity)).toBe(stableInvocationKey({ ...identity }));
  });

  it('does not confuse a later attempt with the unresolved one', () => {
    const identity = {
      taskId: 'task_1',
      graphVersionId: 'direct@3',
      nodeId: 'writer',
      attempt: 1,
      loopIteration: 0,
    };

    // Once a human resolves the turn and the run legitimately retries, the new
    // attempt has its own identity and is not blocked by the old record.
    expect(stableInvocationKey({ ...identity, attempt: 2 })).not.toBe(
      stableInvocationKey(identity),
    );
  });
});
