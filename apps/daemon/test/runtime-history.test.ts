import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventStore, loadGraphRun, openMigratedDatabase } from '@roleflock/database';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * R5: the runtime's event history, read back through the reducer.
 *
 * The orchestrator still writes graph and node state with direct SQL. These
 * typed events are recorded beside those writes, not instead of them, so the
 * projection can be verified before anything is moved behind it. What this
 * pins is that a run rebuilt from its stored history says what the run
 * actually did.
 */

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

const AT = '2026-08-08T10:00:00.000Z';

function database(path?: string) {
  if (path !== undefined) return openMigratedDatabase(path);
  const directory = mkdtempSync(join(tmpdir(), 'roflock-history-'));
  directories.push(directory);
  return openMigratedDatabase(join(directory, 'test.db'));
}

/** Appends to one run's stream the way the orchestrator does. */
function appender(db: ReturnType<typeof openMigratedDatabase>, runId: string) {
  const events = new EventStore(db);
  let sequence = 0;
  return (eventType: string, payload: Record<string, unknown>) => {
    sequence += 1;
    events.append({
      id: `${runId}_evt_${sequence}`,
      aggregateType: 'graph_run',
      aggregateId: runId,
      sequence,
      eventType,
      payload,
      metadata: { schemaVersion: 1 },
      createdAt: AT,
    });
  };
}

function seedCompletedRun(db: ReturnType<typeof openMigratedDatabase>, runId = 'run_1') {
  const append = appender(db, runId);
  append('graph_run.started', {
    runId,
    taskId: 'task_1',
    graphVersionId: 'direct@3',
    semanticHash: 'sha256:abc',
    resumedNodeIds: [],
    resumedLoopIterations: 0,
    at: AT,
  });
  append('node_run.started', { runId, nodeId: 'writer', attempt: 1, loopIteration: 0, at: AT });
  append('node_run.settled', { runId, nodeId: 'writer', attempt: 1, outcome: 'completed', at: AT });
  append('node_run.started', { runId, nodeId: 'test', attempt: 1, loopIteration: 0, at: AT });
  append('node_run.settled', { runId, nodeId: 'test', attempt: 1, outcome: 'completed', at: AT });
  append('graph_run.settled', { runId, outcome: 'completed', at: AT });
  return append;
}

describe('rebuilding a run from its stored history', () => {
  it('reports what the run did', () => {
    const db = database();
    seedCompletedRun(db);

    const run = loadGraphRun(db, 'run_1')!;

    expect(run.state).toBe('settled');
    expect(run.outcome).toBe('completed');
    expect(run.graphVersionId).toBe('direct@3');
    expect(run.nodes.map((node) => node.nodeId).sort()).toEqual(['test', 'writer']);
  });

  it('carries the graph identity the run executed', () => {
    const db = database();
    seedCompletedRun(db);

    // Which compiled graph this was, not merely which version id it answered
    // to — a `.roflock` edit changes one without changing the other.
    expect(loadGraphRun(db, 'run_1')!.semanticHash).toBe('sha256:abc');
  });

  it('projects nothing for a run that emitted nothing', () => {
    // The projection never invents a run that has no history.
    expect(loadGraphRun(database(), 'never_existed')).toBeUndefined();
  });

  it('keeps one task’s runs independent', () => {
    const db = database();
    for (const [runId, resumed] of [
      ['run_1', 0],
      ['run_2', 2],
    ] as const) {
      appender(db, runId)('graph_run.started', {
        runId,
        taskId: 'task_1',
        graphVersionId: 'direct@3',
        resumedNodeIds: resumed > 0 ? ['writer'] : [],
        resumedLoopIterations: resumed,
        at: AT,
      });
    }

    // Events are keyed by run, so a resumed run inherits exactly what its own
    // start event says — never its predecessor's state by accident.
    expect(loadGraphRun(db, 'run_1')!.loopIterations).toBe(0);
    expect(loadGraphRun(db, 'run_2')!.loopIterations).toBe(2);
    expect(loadGraphRun(db, 'run_2')!.nodes.map((n) => n.nodeId)).toEqual(['writer']);
  });

  it('counts a repair loop and drops what it invalidated', () => {
    const db = database();
    const append = appender(db, 'run_1');
    append('graph_run.started', {
      runId: 'run_1',
      taskId: 'task_1',
      graphVersionId: 'direct@3',
      resumedNodeIds: [],
      resumedLoopIterations: 0,
      at: AT,
    });
    append('node_run.started', {
      runId: 'run_1',
      nodeId: 'writer',
      attempt: 1,
      loopIteration: 0,
      at: AT,
    });
    append('node_run.settled', {
      runId: 'run_1',
      nodeId: 'writer',
      attempt: 1,
      outcome: 'completed',
      at: AT,
    });
    append('node_run.started', {
      runId: 'run_1',
      nodeId: 'test',
      attempt: 1,
      loopIteration: 0,
      at: AT,
    });
    append('node_run.settled', {
      runId: 'run_1',
      nodeId: 'test',
      attempt: 1,
      outcome: 'failed',
      failureClass: 'verification_failed',
      at: AT,
    });
    append('loop.reentered', {
      runId: 'run_1',
      iteration: 1,
      from: 'test',
      to: 'writer',
      failureClass: 'verification_failed',
      at: AT,
    });

    const run = loadGraphRun(db, 'run_1')!;

    expect(run.loopIterations).toBe(1);
    // The writer is about to re-run, so its recorded result no longer describes
    // the code that will exist.
    expect(run.nodes.map((node) => node.nodeId)).toEqual(['test']);
  });

  it('records an interrupted run with the reason it stopped', () => {
    const db = database();
    const append = appender(db, 'run_1');
    append('graph_run.started', {
      runId: 'run_1',
      taskId: 'task_1',
      graphVersionId: 'direct@3',
      resumedNodeIds: [],
      resumedLoopIterations: 0,
      at: AT,
    });
    append('graph_run.settled', {
      runId: 'run_1',
      outcome: 'interrupted',
      reason: 'outcome_unknown',
      at: AT,
    });

    const run = loadGraphRun(db, 'run_1')!;

    // Interrupted, not failed — the completed nodes are still good, and the
    // reason tells the operator what decision is waiting for them.
    expect(run.outcome).toBe('interrupted');
    expect(run.reason).toBe('outcome_unknown');
  });

  it('survives the daemon reopening the database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'roflock-history-'));
    directories.push(directory);
    const path = join(directory, 'test.db');

    const first = database(path);
    seedCompletedRun(first);
    first.close();

    // The history is in the file, not in the process that wrote it.
    const second = database(path);
    expect(loadGraphRun(second, 'run_1')?.outcome).toBe('completed');
    second.close();
  });
});
