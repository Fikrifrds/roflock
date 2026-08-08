import { graphIrToWorkflowGraph, type WorkflowGraph } from '@roleflock/graph-core';
import { compile } from '@roleflock/language';
import { describe, expect, it } from 'vitest';
import { NodeFailure, runGraph, type NodeContext } from './index.js';

/**
 * R5: a repair budget that survives a daemon restart.
 *
 * `runGraph` bounds re-entries with `maxLoopIterations`, but the counter used to
 * start at zero on every call. Resuming a crashed run therefore handed the task
 * a whole new budget — a run that had already spent three attempts could spend
 * three more, paying a provider for each. The budget belongs to the task, not to
 * the process executing it.
 */

const REPAIR = `
workflow Repair { version "1.0.0" max_cost 5 }
role implementer { write }
agent Builder { role implementer objective "fix it" retry 1 }
check Tests { run "npm test" required }
human Accept
flow {
  Builder -> Tests
  Tests.pass -> Accept
  Tests.fail -> Builder { max 3 }
}
`;

function repairGraph(): WorkflowGraph {
  const compiled = compile(REPAIR, { uri: 'repair.roflock' });
  const bridged = graphIrToWorkflowGraph(compiled.ir!);
  return bridged.graph!;
}

/** A run that can be interrupted after a set number of node executions. */
function interruptibleExecutor(options: { failTests: boolean; stopAfter?: number }) {
  const ran: string[] = [];
  const controller = new AbortController();
  const execute = async (context: NodeContext) => {
    ran.push(context.node.id);
    if (options.stopAfter !== undefined && ran.length >= options.stopAfter) {
      controller.abort();
    }
    if (context.node.id === 'Tests' && options.failTests) {
      throw new NodeFailure('tests failed', 'verification_failed', { repairClass: 'test' });
    }
    return context.node.id;
  };
  return {
    ran,
    execute,
    signal: controller.signal,
    timesRun: (id: string) => ran.filter((r) => r === id).length,
  };
}

const allowRepairs = { evaluateEdgeGuard: () => true };

describe('repair budget across a restart', () => {
  it('spends exactly the declared attempts in one uninterrupted run', async () => {
    const executor = interruptibleExecutor({ failTests: true });
    const result = await runGraph(repairGraph(), executor.execute, allowRepairs);

    expect(result.state).toBe('failed');
    expect(result.loopIterations).toBe(2);
    expect(executor.timesRun('Builder')).toBe(3);
  });

  it('reports each re-entry so the caller can persist it', async () => {
    const seen: Array<{ iteration: number; from: string; to: string }> = [];
    const executor = interruptibleExecutor({ failTests: true });

    await runGraph(repairGraph(), executor.execute, {
      ...allowRepairs,
      onLoopIteration: ({ iteration, from, to }) => seen.push({ iteration, from, to }),
    });

    expect(seen).toEqual([
      { iteration: 1, from: 'Tests', to: 'Builder' },
      { iteration: 2, from: 'Tests', to: 'Builder' },
    ]);
  });

  it('does not hand a resumed run a fresh budget', async () => {
    const graph = repairGraph();

    // First process: burns the whole budget, then the daemon dies.
    const before = interruptibleExecutor({ failTests: true });
    const first = await runGraph(graph, before.execute, allowRepairs);
    expect(first.loopIterations).toBe(2);

    // Second process: resumes carrying what was already spent.
    const after = interruptibleExecutor({ failTests: true });
    const second = await runGraph(graph, after.execute, {
      ...allowRepairs,
      resumeLoopIterations: first.loopIterations,
    });

    expect(second.state).toBe('failed');
    // No further re-entries were available, so the writer ran once and stopped.
    expect(second.loopIterations).toBe(2);
    expect(after.timesRun('Builder')).toBe(1);
    expect(after.timesRun('Tests')).toBe(1);
  });

  it('lets a resumed run spend only what is left', async () => {
    const graph = repairGraph();
    const after = interruptibleExecutor({ failTests: true });

    // One re-entry already spent before the crash; one remains.
    const result = await runGraph(graph, after.execute, {
      ...allowRepairs,
      resumeLoopIterations: 1,
    });

    expect(result.loopIterations).toBe(2);
    expect(after.timesRun('Builder')).toBe(2);
  });

  it('still completes when a resumed run succeeds within the remaining budget', async () => {
    const graph = repairGraph();
    const after = interruptibleExecutor({ failTests: false });

    const result = await runGraph(graph, after.execute, {
      ...allowRepairs,
      resumeLoopIterations: 2,
    });

    // Exhausting the budget is not itself a failure — only failing after it is.
    expect(result.state).toBe('completed');
  });

  it('resumes confirmed nodes and the budget together', async () => {
    const graph = repairGraph();
    const after = interruptibleExecutor({ failTests: false });

    const result = await runGraph(graph, after.execute, {
      ...allowRepairs,
      resumeCompleted: ['Builder'],
      resumeLoopIterations: 1,
    });

    expect(result.state).toBe('completed');
    // The writer's confirmed work was not repeated.
    expect(after.timesRun('Builder')).toBe(0);
    expect(after.timesRun('Tests')).toBe(1);
  });

  it('treats a missing resume value as a fresh run', async () => {
    const executor = interruptibleExecutor({ failTests: true });
    const result = await runGraph(repairGraph(), executor.execute, allowRepairs);

    expect(result.loopIterations).toBe(2);
  });
});
