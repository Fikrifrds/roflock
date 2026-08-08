import type {
  EventEnvelope,
  GraphRunProjection,
  NodeRunProjection,
  RuntimeEvent,
} from '@roleflock/contracts';
import { EventStore } from '../repositories/event-store.js';
import type { SqliteDb } from '../client.js';

/**
 * Deterministic reduction of runtime events into a graph run's state.
 *
 * The same event sequence must always produce the same projection: that is what
 * makes the history usable as evidence rather than as a log. Illegal
 * transitions throw rather than being absorbed, because a projection that
 * quietly repairs a contradictory history hides the bug that produced it.
 */

export class RuntimeHistoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeHistoryError';
  }
}

export function reduceGraphRun(
  current: GraphRunProjection | undefined,
  event: RuntimeEvent,
): GraphRunProjection {
  if (event.type === 'graph_run.started') {
    if (current !== undefined) {
      throw new RuntimeHistoryError(`Graph run ${event.runId} started twice`);
    }
    return {
      runId: event.runId,
      taskId: event.taskId,
      graphVersionId: event.graphVersionId,
      ...(event.semanticHash === undefined ? {} : { semanticHash: event.semanticHash }),
      state: 'running',
      // A resumed run inherits what its predecessor already spent. Starting at
      // zero would hand it a fresh repair budget and pay for the same attempts
      // a second time.
      loopIterations: event.resumedLoopIterations,
      nodes: event.resumedNodeIds.map((nodeId) => ({
        nodeId,
        state: 'settled' as const,
        attempt: 0,
        outcome: 'completed' as const,
      })),
      startedAt: event.at,
    };
  }

  if (current === undefined) {
    throw new RuntimeHistoryError(`Event ${event.type} arrived before its graph run started`);
  }

  switch (event.type) {
    case 'node_run.started': {
      const nodes = withNode(current.nodes, {
        nodeId: event.nodeId,
        state: 'running',
        attempt: event.attempt,
      });
      return { ...current, nodes };
    }

    case 'node_run.settled': {
      const existing = current.nodes.find((node) => node.nodeId === event.nodeId);
      if (existing === undefined || existing.state !== 'running') {
        throw new RuntimeHistoryError(
          `Node ${event.nodeId} settled without a matching start in run ${event.runId}`,
        );
      }
      const settled: NodeRunProjection = {
        nodeId: event.nodeId,
        state: 'settled',
        attempt: event.attempt,
        outcome: event.outcome,
        ...(event.failureClass === undefined ? {} : { failureClass: event.failureClass }),
      };
      return { ...current, nodes: withNode(current.nodes, settled) };
    }

    case 'loop.reentered': {
      if (event.iteration !== current.loopIterations + 1) {
        // Re-entries are counted, not guessed. A gap means an event was lost,
        // and silently accepting it would understate what was already paid for.
        throw new RuntimeHistoryError(
          `Loop re-entry ${event.iteration} does not follow ${current.loopIterations} in run ${event.runId}`,
        );
      }
      // Everything downstream of the loop target re-runs, so their recorded
      // results no longer describe the code that exists.
      return {
        ...current,
        loopIterations: event.iteration,
        nodes: current.nodes.filter((node) => node.nodeId !== event.to),
      };
    }

    case 'graph_run.settled': {
      if (current.state === 'settled') {
        throw new RuntimeHistoryError(`Graph run ${event.runId} settled twice`);
      }
      return {
        ...current,
        state: 'settled',
        outcome: event.outcome,
        ...(event.reason === undefined ? {} : { reason: event.reason }),
        settledAt: event.at,
      };
    }
  }
}

function withNode(
  nodes: readonly NodeRunProjection[],
  next: NodeRunProjection,
): NodeRunProjection[] {
  const without = nodes.filter((node) => node.nodeId !== next.nodeId);
  return [...without, next];
}

/** Folds a whole history. Order is the caller's responsibility. */
export function projectGraphRun(events: readonly RuntimeEvent[]): GraphRunProjection | undefined {
  let projection: GraphRunProjection | undefined;
  for (const event of events) projection = reduceGraphRun(projection, event);
  return projection;
}

/**
 * Rebuilds a run from the stored history.
 *
 * Events are keyed by graph run rather than by task, so one task's several runs
 * project independently and a resumed run does not inherit its predecessor's
 * node states by accident.
 */
export function loadGraphRun(db: SqliteDb, runId: string): GraphRunProjection | undefined {
  const stored = new EventStore(db).list(runId);
  return projectGraphRun(stored.map(toRuntimeEvent));
}

function toRuntimeEvent(envelope: EventEnvelope): RuntimeEvent {
  return { ...(envelope.payload as object), type: envelope.eventType } as RuntimeEvent;
}
