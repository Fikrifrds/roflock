import { sha256Canonical } from '@roleflock/contracts';
import type { GraphIR } from './types.js';

/**
 * Canonicalisation and semantic identity for Graph IR.
 *
 * A run records the `semanticHash` of the graph it executed. Two documents that
 * mean the same thing must therefore produce the same hash, and any change in
 * meaning must produce a different one — otherwise a workflow edit could
 * silently reinterpret a historical run.
 *
 * The hash is computed with `node:crypto` through `@roleflock/contracts`. That
 * is the one part of this package that is not browser-safe; RF-EVO-150 replaces
 * the digest for the Playground and should not need to touch anything else here.
 */

/**
 * Fields excluded from semantic identity, per RFC-001 §17.
 *
 * Each is excluded because changing it does not change what the workflow does:
 * `debug` is source maps and editor layout, and the two source fields describe
 * the bytes a document was produced from rather than its meaning. Reformatting
 * a `.roflock` file or dragging a node in Studio must not invalidate a run's
 * recorded identity.
 */
export interface SemanticIR extends Omit<GraphIR, 'debug'> {
  debug?: never;
}

/** Strips everything non-semantic, leaving the document that identity is computed over. */
export function toSemanticIR(ir: GraphIR): SemanticIR {
  const { debug: _debug, ...rest } = ir;
  const semantic: SemanticIR = {
    ...rest,
    workflow: { ...rest.workflow },
  };

  // The hash cannot include itself, and source provenance is not meaning.
  delete semantic.workflow.semanticHash;
  if (semantic.workflow.source) {
    const { uri: _uri, sourceHash: _sourceHash, ...source } = semantic.workflow.source;
    semantic.workflow = { ...semantic.workflow, source };
  }

  return semantic;
}

/**
 * Stable order for collections whose order carries no meaning.
 *
 * Nodes, edges, roles and the rest are sets: declaring a role before or after
 * another says nothing about execution, which is decided entirely by edges and
 * dependencies. Sorting them means two authors who wrote the same workflow in a
 * different order get the same hash. Arrays whose order *is* meaningful —
 * `entryNodeIds` sequencing, a node's `outcomes` preference order, edge
 * `priority` — are left exactly as written.
 */
function sortById<T extends { id: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Normalises a document into canonical form without changing its meaning. */
export function normalizeIR(ir: GraphIR): GraphIR {
  return {
    ...ir,
    irVersion: ir.irVersion,
    workflow: {
      ...ir.workflow,
      entryNodeIds: [...ir.workflow.entryNodeIds],
      terminalNodeIds: [...ir.workflow.terminalNodeIds].sort(),
    },
    goals: sortById(ir.goals).map((goal) => ({ ...goal, criteria: sortById(goal.criteria) })),
    artifacts: sortById(ir.artifacts),
    roles: sortById(ir.roles),
    nodes: sortById(ir.nodes),
    edges: sortById(ir.edges),
    loops: sortById(ir.loops).map((loop) => ({
      ...loop,
      nodeIds: [...loop.nodeIds].sort(),
      edgeIds: [...loop.edgeIds].sort(),
    })),
    profiles: sortById(ir.profiles),
  };
}

/** SHA-256 over the canonical JSON of the semantic document. */
export function semanticHash(ir: GraphIR): string {
  return `sha256:${sha256Canonical(toSemanticIR(normalizeIR(ir)))}`;
}

/** Returns a copy carrying its own semantic hash, ready to persist against a run. */
export function stampSemanticHash(ir: GraphIR): GraphIR {
  const normalized = normalizeIR(ir);
  return {
    ...normalized,
    workflow: { ...normalized.workflow, semanticHash: semanticHash(normalized) },
  };
}
