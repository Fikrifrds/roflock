import { graphIrToWorkflowGraph } from './ir-bridge.js';
import {
  GRAPH_SCHEMA_VERSION,
  getWorkflowGraph,
  graphVersionId,
  parseGraphVersionId,
  type GraphMode,
  type WorkflowGraph,
} from './index.js';

/**
 * Workflow templates compiled from `.roflock` source.
 *
 * The built-in graphs live in `workflows/*.roflock` and are the source of truth
 * for **new** runs. The hard-coded TypeScript definitions in this package stay
 * as history: a task pinned to `bug_fix@1` must keep the semantics it started
 * with, and deleting the version it recorded would make that run unreproducible.
 *
 * A caller supplies compiled graphs rather than this package reading the
 * filesystem, because `graph-core` is imported by the browser-facing UI and
 * must stay free of `node:fs`. The daemon registers them at boot; anything that
 * has not registered falls back to the built-ins, which is why a missing
 * registration degrades to today's behaviour rather than to no workflow at all.
 */

const registry = new Map<string, WorkflowGraph>();

/** Replaces the registered templates. Passing nothing clears them. */
export function registerWorkflowTemplates(graphs: readonly WorkflowGraph[] = []): void {
  registry.clear();
  for (const graph of graphs) registry.set(graph.id, graph);
}

export function registeredWorkflowTemplates(): readonly WorkflowGraph[] {
  return [...registry.values()];
}

/**
 * Resolves the graph a run should use.
 *
 * A pinned historical version always wins: it is a record of what already
 * happened. Only a request for the current version — a new task — is served
 * from compiled source.
 */
export function resolveWorkflowGraph(modeOrVersion: string): WorkflowGraph {
  const { mode, version } = parseGraphVersionId(modeOrVersion);

  if (version !== undefined && version !== GRAPH_SCHEMA_VERSION) {
    return getWorkflowGraph(modeOrVersion);
  }

  const compiled = registry.get(mode);
  if (compiled !== undefined) {
    // Keep the legacy version id so persisted runs, event payloads and the
    // historical resolver all continue to agree on what this graph is called.
    return { ...compiled, version: graphVersionId(mode as GraphMode) };
  }

  return getWorkflowGraph(modeOrVersion);
}

/**
 * Compiles Graph IR into runtime graphs, keeping only those that bridge
 * cleanly.
 *
 * Returns the failures too. A template that no longer compiles is an operator
 * problem worth reporting, not a reason to start the daemon with a silently
 * shorter list of workflows.
 */
export function buildWorkflowTemplates(
  sources: ReadonlyArray<{ id: string; ir: Parameters<typeof graphIrToWorkflowGraph>[0] }>,
): { templates: WorkflowGraph[]; failures: Array<{ id: string; reasons: string[] }> } {
  const templates: WorkflowGraph[] = [];
  const failures: Array<{ id: string; reasons: string[] }> = [];

  for (const source of sources) {
    const bridged = graphIrToWorkflowGraph(source.ir);
    if (bridged.graph) templates.push(bridged.graph);
    else failures.push({ id: source.id, reasons: bridged.diagnostics.map((d) => d.message) });
  }

  return { templates, failures };
}
