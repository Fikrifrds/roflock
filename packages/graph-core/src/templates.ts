import type { GraphIR } from '@roleflock/graph-ir';
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

/**
 * A registered template, keeping the IR it was bridged from.
 *
 * The bridge is one-way: it lowers IR into a `WorkflowGraph` and the IR is not
 * recoverable from the result. Discarding it meant nothing downstream could use
 * the shared layout model for a running task — a Studio diagram would have had to
 * compute its own positions from the runtime graph, which is exactly the
 * divergence `graph-ui` exists to prevent. So both are kept.
 */
export interface RegisteredTemplate {
  graph: WorkflowGraph;
  /** Present for a compiled template; absent for a hard-coded built-in. */
  ir?: GraphIR;
  /**
   * The `.roflock` text this was compiled from.
   *
   * Kept so Studio can show the workflow a run is executing, rather than a
   * reconstruction of it. A regenerated source would be a second rendering of
   * the same graph and could disagree with the file on disk.
   */
  source?: string;
}

const registry = new Map<string, RegisteredTemplate>();

/** Replaces the registered templates. Passing nothing clears them. */
export function registerWorkflowTemplates(
  templates: ReadonlyArray<WorkflowGraph | RegisteredTemplate> = [],
): void {
  registry.clear();
  for (const entry of templates) {
    const template = 'graph' in entry ? entry : { graph: entry };
    registry.set(template.graph.id, template);
  }
}

export function registeredWorkflowTemplates(): readonly WorkflowGraph[] {
  return [...registry.values()].map((template) => template.graph);
}

/**
 * The Graph IR a template was compiled from, when there is one.
 *
 * This is what lets a diagram anywhere — Studio, the Playground, `roflock
 * render` — draw from one model rather than three.
 */
export function registeredWorkflowIr(mode: string): GraphIR | undefined {
  return registry.get(parseGraphVersionId(mode).mode)?.ir;
}

/** The `.roflock` text a template was compiled from, when there is one. */
export function registeredWorkflowSource(mode: string): string | undefined {
  return registry.get(parseGraphVersionId(mode).mode)?.source;
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

  const compiled = registry.get(mode)?.graph;
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
  sources: ReadonlyArray<{ id: string; ir: GraphIR; source?: string }>,
): {
  templates: RegisteredTemplate[];
  failures: Array<{ id: string; reasons: string[] }>;
} {
  const templates: RegisteredTemplate[] = [];
  const failures: Array<{ id: string; reasons: string[] }> = [];

  for (const source of sources) {
    const bridged = graphIrToWorkflowGraph(source.ir);
    if (bridged.graph) {
      templates.push({
        graph: bridged.graph,
        ir: source.ir,
        ...(source.source === undefined ? {} : { source: source.source }),
      });
    } else {
      failures.push({ id: source.id, reasons: bridged.diagnostics.map((d) => d.message) });
    }
  }

  return { templates, failures };
}
