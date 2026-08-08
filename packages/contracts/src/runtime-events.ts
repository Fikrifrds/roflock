/**
 * Typed runtime events and the state they project to.
 *
 * Graph IR says what *may* happen; these say what *did*. Today the orchestrator
 * writes runtime state with direct SQL and appends loosely-typed events
 * alongside it. This module gives those events a shape and a deterministic
 * reduction, so the same run can be rebuilt from its history and checked against
 * the rows — instrumenting the existing behaviour before anything is moved
 * behind it.
 *
 * Per ADR-020 these live in `contracts` and are persisted through the storage
 * kernel. Nothing here may reference a domain package: the runtime is meant to
 * execute any compiled workflow, not only coding ones.
 */

export type RuntimeEventType =
  | 'graph_run.started'
  | 'graph_run.settled'
  | 'node_run.started'
  | 'node_run.settled'
  | 'loop.reentered';

/** How a run or a node ended. `unknown` is a real answer, not a missing one. */
export type RuntimeOutcome =
  'completed' | 'failed' | 'skipped' | 'interrupted' | 'cancelled' | 'unknown';

export interface RuntimeEventBase {
  /** The graph run this belongs to. Events are ordered per run. */
  runId: string;
  /**
   * Semantic identity of the graph being executed, when it has one.
   * A built-in TypeScript template has none; its version id is its identity.
   */
  semanticHash?: string;
  at: string;
}

export interface GraphRunStarted extends RuntimeEventBase {
  type: 'graph_run.started';
  taskId: string;
  graphVersionId: string;
  /** Nodes carried over from an interrupted run, and re-entries already spent. */
  resumedNodeIds: string[];
  resumedLoopIterations: number;
}

export interface GraphRunSettled extends RuntimeEventBase {
  type: 'graph_run.settled';
  outcome: RuntimeOutcome;
  /** Why it stopped, when it stopped for a reason worth naming. */
  reason?: string;
}

export interface NodeRunStarted extends RuntimeEventBase {
  type: 'node_run.started';
  nodeId: string;
  attempt: number;
  loopIteration: number;
}

export interface NodeRunSettled extends RuntimeEventBase {
  type: 'node_run.settled';
  nodeId: string;
  attempt: number;
  outcome: RuntimeOutcome;
  /** The runtime's failure classification, when the node did not succeed. */
  failureClass?: string;
}

export interface LoopReentered extends RuntimeEventBase {
  type: 'loop.reentered';
  iteration: number;
  from: string;
  to: string;
  failureClass: string;
}

export type RuntimeEvent =
  GraphRunStarted | GraphRunSettled | NodeRunStarted | NodeRunSettled | LoopReentered;

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

export interface NodeRunProjection {
  nodeId: string;
  state: 'running' | 'settled';
  attempt: number;
  outcome?: RuntimeOutcome;
  failureClass?: string;
}

export interface GraphRunProjection {
  runId: string;
  taskId: string;
  graphVersionId: string;
  semanticHash?: string;
  state: 'running' | 'settled';
  outcome?: RuntimeOutcome;
  reason?: string;
  /**
   * Re-entries spent, including those inherited from the run this one resumed.
   * This is the number a restart must carry forward, not restart from zero.
   */
  loopIterations: number;
  nodes: NodeRunProjection[];
  startedAt: string;
  settledAt?: string;
}

/** Outcomes that mean the node's work stands and need not be repeated. */
export function isConfirmed(outcome: RuntimeOutcome | undefined): boolean {
  return outcome === 'completed';
}

/**
 * Outcomes a resumed run must not treat as settled.
 *
 * `unknown` is deliberately included: it is the honest answer for work whose
 * result nobody observed, and treating it as either success or failure would be
 * a guess the runtime has no basis for (ADR-010).
 */
export function isUnresolved(outcome: RuntimeOutcome | undefined): boolean {
  return outcome === undefined || outcome === 'unknown' || outcome === 'interrupted';
}
