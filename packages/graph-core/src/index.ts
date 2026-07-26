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

export function validateGraph(graph: WorkflowGraph): string[] {
  const ids = new Set(graph.nodes.map((node) => node.id));
  const errors: string[] = [];
  if (ids.size !== graph.nodes.length) errors.push('duplicate node id');
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
  return errors;
}

/** @deprecated use WorkflowRole */
export type BugFixRole = WorkflowRole;
