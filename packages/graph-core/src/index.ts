import type { RiskClass, TaskType } from '@roleflock/contracts';

export type GraphMode = 'direct' | 'fast' | 'standard' | 'bug_fix' | 'critical';

export type WorkflowRole =
  | 'planner'
  | 'reviewer'
  | 'writer'
  | 'test'
  | 'verifier'
  | 'accept';

export interface GraphNode {
  id: WorkflowRole;
  dependsOn: WorkflowRole[];
}

export interface WorkflowGraph {
  id: GraphMode;
  label: string;
  description: string;
  nodes: GraphNode[];
}

export interface WorkflowRecommendation {
  mode: GraphMode;
  rationale: string;
  overridable: true;
}

export const bugFixGraph: WorkflowGraph = {
  id: 'bug_fix',
  label: 'Verified Bug Fix',
  description: 'Planner → reviewer → writer → test → verifier → human accept',
  nodes: [
    { id: 'planner', dependsOn: [] },
    { id: 'reviewer', dependsOn: ['planner'] },
    { id: 'writer', dependsOn: ['reviewer'] },
    { id: 'test', dependsOn: ['writer'] },
    { id: 'verifier', dependsOn: ['test'] },
    { id: 'accept', dependsOn: ['verifier'] },
  ],
};

/** Smallest path: write + deterministic test + human accept */
export const directGraph: WorkflowGraph = {
  id: 'direct',
  label: 'Direct',
  description: 'Writer → test → human accept',
  nodes: [
    { id: 'writer', dependsOn: [] },
    { id: 'test', dependsOn: ['writer'] },
    { id: 'accept', dependsOn: ['test'] },
  ],
};

/** Fast path: plan lightly, write, test, accept */
export const fastGraph: WorkflowGraph = {
  id: 'fast',
  label: 'Fast',
  description: 'Planner → writer → test → human accept',
  nodes: [
    { id: 'planner', dependsOn: [] },
    { id: 'writer', dependsOn: ['planner'] },
    { id: 'test', dependsOn: ['writer'] },
    { id: 'accept', dependsOn: ['test'] },
  ],
};

/** Standard path: plan, review, write, test, verify, accept */
export const standardGraph: WorkflowGraph = {
  id: 'standard',
  label: 'Standard',
  description: 'Planner → reviewer → writer → test → verifier → human accept',
  nodes: bugFixGraph.nodes,
};

/** Critical feature: same as bug fix but labeled for higher-risk work */
export const criticalGraph: WorkflowGraph = {
  id: 'critical',
  label: 'Critical Feature',
  description:
    'High-risk path: planner → reviewer → writer → test → verifier → human accept',
  nodes: bugFixGraph.nodes,
};

export const workflowGraphs: Record<GraphMode, WorkflowGraph> = {
  direct: directGraph,
  fast: fastGraph,
  standard: standardGraph,
  bug_fix: bugFixGraph,
  critical: criticalGraph,
};

export function getWorkflowGraph(mode: string): WorkflowGraph {
  const graph = workflowGraphs[mode as GraphMode];
  if (!graph) throw new Error(`Unknown workflow mode: ${mode}`);
  return graph;
}

/**
 * Smallest-sufficient graph necessity gate.
 * Users may override the recommendation before start.
 */
export function recommendWorkflow(input: {
  type: TaskType;
  risk?: RiskClass;
}): WorkflowRecommendation {
  const risk = input.risk ?? 'medium';

  if (
    risk === 'critical' ||
    input.type === 'new_product' ||
    input.type === 'security_fix' ||
    input.type === 'migration'
  ) {
    return {
      mode: 'critical',
      rationale: 'High-impact work needs independent review and verification before accept.',
      overridable: true,
    };
  }

  if (input.type === 'bug_fix') {
    return {
      mode: 'bug_fix',
      rationale: 'Bug fixes use the verified fix path with reviewer confirmation.',
      overridable: true,
    };
  }

  if (
    input.type === 'investigation' ||
    input.type === 'review_changes' ||
    input.type === 'documentation'
  ) {
    return {
      mode: 'direct',
      rationale: 'Read-oriented or narrow work does not need a full planning graph.',
      overridable: true,
    };
  }

  if (
    risk === 'low' ||
    input.type === 'test_improvement' ||
    input.type === 'dependency_update' ||
    input.type === 'performance'
  ) {
    return {
      mode: 'fast',
      rationale: 'Low-risk localised changes can skip reviewer overhead.',
      overridable: true,
    };
  }

  if (risk === 'high') {
    return {
      mode: 'critical',
      rationale: 'Elevated risk warrants the critical verification path.',
      overridable: true,
    };
  }

  return {
    mode: 'standard',
    rationale: 'Default feature path balances planning, review, and verification.',
    overridable: true,
  };
}

export function validateGraph(graph: WorkflowGraph): string[] {
  const ids = new Set(graph.nodes.map((node) => node.id));
  const errors: string[] = [];
  if (graph.nodes.length === 0) errors.push('graph has no nodes');
  if (ids.size !== graph.nodes.length) errors.push('duplicate node id');

  const writers = graph.nodes.filter((node) => node.id === 'writer');
  if (writers.length > 1) errors.push('parallel writers are not allowed');
  if (writers.length === 0) errors.push('graph requires a writer node');
  if (!ids.has('accept')) errors.push('graph requires a terminal accept node');

  for (const node of graph.nodes) {
    for (const dependency of node.dependsOn) {
      if (!ids.has(dependency)) errors.push(`${node.id} depends on missing ${dependency}`);
      if (dependency === node.id) errors.push(`${node.id} depends on itself`);
    }
  }

  const visit = (
    id: string,
    visiting = new Set<string>(),
    visited = new Set<string>(),
  ): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const node = graph.nodes.find((n) => n.id === id);
    const cycle = node?.dependsOn.some((dep) => visit(dep, visiting, visited)) ?? false;
    visiting.delete(id);
    visited.add(id);
    return cycle;
  };
  if (graph.nodes.some((node) => visit(node.id))) errors.push('cycle detected');

  // Accept must be reachable from every writer (and generally a sink).
  if (ids.has('accept') && ids.has('writer')) {
    const reachable = new Set<string>();
    const walk = (id: string) => {
      if (reachable.has(id)) return;
      reachable.add(id);
      for (const node of graph.nodes) {
        if (node.dependsOn.includes(id as WorkflowRole)) walk(node.id);
      }
    };
    walk('writer');
    if (!reachable.has('accept')) {
      errors.push('accept is unreachable from writer');
    }
  }

  return errors;
}

/** @deprecated use WorkflowRole */
export type BugFixRole = WorkflowRole;
