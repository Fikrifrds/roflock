import type { GraphEdge, GraphIR, GraphNode } from '@roleflock/graph-ir';

/**
 * A renderable projection of Graph IR.
 *
 * Shared deliberately: the Playground, Studio and the CLI must draw the same
 * workflow the same way, and a private model per surface is how three views of
 * one graph start disagreeing about what it does.
 *
 * Browser-safe and DOM-free. This computes *what* to draw, never how — no
 * measurement, no styling, no framework. That keeps it testable, which matters
 * because a diagram that quietly omits a failure route is worse than no diagram.
 */

/** What a node is, for someone reading the picture rather than the source. */
export type NodeShape = 'agent' | 'check' | 'human' | 'action' | 'control' | 'terminal';

/** Facts a reader needs at a glance, each derived from the IR rather than styled in. */
export interface NodeBadges {
  /** Holds the workspace write lease. At most one may run at a time. */
  writer: boolean;
  /** Cannot be bypassed on the way to acceptance. */
  required: boolean;
  /** Waits for a person. */
  human: boolean;
  /** Belongs to a bounded retry loop. */
  looping: boolean;
  /** Declares a protected side effect. */
  protectedEffect: boolean;
}

export interface LaidOutNode {
  id: string;
  label: string;
  shape: NodeShape;
  badges: NodeBadges;
  roleRef?: string;
  /** Distance from an entry node along success edges. Drives vertical order. */
  rank: number;
  /** Position within the rank, left to right. */
  order: number;
  /** Live state, when a run's projection was supplied. */
  state?: 'pending' | 'running' | 'settled';
  outcome?: string;
}

export type EdgeKind = 'success' | 'failure' | 'terminal';

export interface LaidOutEdge {
  id: string;
  from: string;
  to: string;
  outcome: string;
  kind: EdgeKind;
  /** True when the edge runs backwards — a repair route. */
  backwards: boolean;
  /** A policy the edge must satisfy before it may be taken. */
  guard?: string;
}

export interface GraphLayout {
  workflowId: string;
  workflowName: string;
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  /** Nodes grouped by rank, in draw order. */
  ranks: string[][];
  loops: Array<{ id: string; nodeIds: string[]; maxAttempts: number; verifierNodeId: string }>;
}

const SUCCESS_OUTCOMES = new Set(['completed', 'pass', 'human_approved']);

function shapeOf(node: GraphNode): NodeShape {
  switch (node.kind) {
    case 'agent':
    case 'model_call':
      return 'agent';
    case 'check':
      return 'check';
    case 'human':
      return 'human';
    case 'action':
      return 'action';
    default:
      return 'control';
  }
}

const PROTECTED = new Set([
  'git_push',
  'merge',
  'deploy',
  'production_access',
  'payment_mutation',
  'public_publish',
  'destructive',
]);

function badgesOf(node: GraphNode, ir: GraphIR, looping: Set<string>): NodeBadges {
  const role = ir.roles.find((candidate) => candidate.id === node.roleRef);
  return {
    writer:
      node.effects?.some((effect) => effect.class === 'workspace_write') === true ||
      role?.accessMode === 'write',
    required: node.kind === 'check' && node.check.required === true,
    human: node.kind === 'human',
    looping: looping.has(node.id),
    protectedEffect: node.effects?.some((effect) => PROTECTED.has(effect.class)) === true,
  };
}

/**
 * Longest distance from an entry along success edges.
 *
 * Longest rather than shortest so a node never draws above something it depends
 * on — a picture that puts the reviewer before the planner is worse than no
 * picture. Failure edges are excluded because they run backwards by definition.
 */
function ranksOf(ir: GraphIR): Map<string, number> {
  const rank = new Map<string, number>(ir.nodes.map((node) => [node.id, 0]));
  const incoming = new Map<string, string[]>();
  for (const edge of ir.edges) {
    if (!SUCCESS_OUTCOMES.has(edge.from.outcome)) continue;
    incoming.set(edge.to.nodeId, [...(incoming.get(edge.to.nodeId) ?? []), edge.from.nodeId]);
  }
  // Relaxed once per node, which is enough because success edges form a DAG.
  for (let pass = 0; pass < ir.nodes.length; pass += 1) {
    for (const node of ir.nodes) {
      for (const source of incoming.get(node.id) ?? []) {
        rank.set(node.id, Math.max(rank.get(node.id) ?? 0, (rank.get(source) ?? 0) + 1));
      }
    }
  }
  return rank;
}

export interface LayoutOptions {
  /** Live node states, keyed by node id, from a run projection. */
  state?: Record<string, { state: 'pending' | 'running' | 'settled'; outcome?: string }>;
}

export function layoutGraph(ir: GraphIR, options: LayoutOptions = {}): GraphLayout {
  const rank = ranksOf(ir);
  const looping = new Set(ir.loops.flatMap((loop) => loop.nodeIds));

  // Declaration order breaks ties within a rank, so the same document always
  // draws the same way. A layout that shifted between renders would make a
  // diagram useless for spotting what changed.
  const declarationOrder = new Map(ir.nodes.map((node, index) => [node.id, index]));
  const byRank = new Map<number, GraphNode[]>();
  for (const node of ir.nodes) {
    const level = rank.get(node.id) ?? 0;
    byRank.set(level, [...(byRank.get(level) ?? []), node]);
  }
  for (const [, members] of byRank) {
    members.sort((a, b) => (declarationOrder.get(a.id) ?? 0) - (declarationOrder.get(b.id) ?? 0));
  }

  const nodes: LaidOutNode[] = [];
  const ranks: string[][] = [];
  for (const level of [...byRank.keys()].sort((a, b) => a - b)) {
    const members = byRank.get(level) ?? [];
    ranks.push(members.map((node) => node.id));
    members.forEach((node, order) => {
      const live = options.state?.[node.id];
      nodes.push({
        id: node.id,
        label: node.name,
        shape: node.outcomes.some((outcome) => outcome.terminal && outcome.accepted)
          ? 'terminal'
          : shapeOf(node),
        badges: badgesOf(node, ir, looping),
        rank: level,
        order,
        ...(node.roleRef === undefined ? {} : { roleRef: node.roleRef }),
        ...(live === undefined ? {} : { state: live.state }),
        ...(live?.outcome === undefined ? {} : { outcome: live.outcome }),
      });
    });
  }

  const edges: LaidOutEdge[] = ir.edges.map((edge: GraphEdge) => {
    const source = ir.nodes.find((node) => node.id === edge.from.nodeId);
    const terminal = source?.outcomes.find((outcome) => outcome.id === edge.from.outcome)?.terminal;
    const success = SUCCESS_OUTCOMES.has(edge.from.outcome);
    return {
      id: edge.id,
      from: edge.from.nodeId,
      to: edge.to.nodeId,
      outcome: edge.from.outcome,
      kind: terminal === true ? 'terminal' : success ? 'success' : 'failure',
      // A repair route: it leads back to something already drawn above it.
      backwards: (rank.get(edge.to.nodeId) ?? 0) <= (rank.get(edge.from.nodeId) ?? 0),
      ...(edge.guard !== undefined && edge.guard.type === 'policy'
        ? { guard: edge.guard.policyRef }
        : {}),
    };
  });

  return {
    workflowId: ir.workflow.id,
    workflowName: ir.workflow.name,
    nodes,
    edges,
    ranks,
    loops: ir.loops.map((loop) => ({
      id: loop.id,
      nodeIds: [...loop.nodeIds].sort(),
      maxAttempts: loop.policy.maxAttempts,
      verifierNodeId: loop.policy.verifierNodeId,
    })),
  };
}
