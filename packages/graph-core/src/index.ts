export type BugFixRole = 'planner' | 'reviewer' | 'writer' | 'test' | 'verifier' | 'accept';
export interface GraphNode { id: BugFixRole; dependsOn: BugFixRole[]; }
export interface WorkflowGraph { id: string; nodes: GraphNode[]; }
export const bugFixGraph: WorkflowGraph = { id: 'bug_fix', nodes: [
  { id: 'planner', dependsOn: [] }, { id: 'reviewer', dependsOn: ['planner'] }, { id: 'writer', dependsOn: ['reviewer'] },
  { id: 'test', dependsOn: ['writer'] }, { id: 'verifier', dependsOn: ['test'] }, { id: 'accept', dependsOn: ['verifier'] },
] };
export function validateGraph(graph: WorkflowGraph): string[] {
  const ids = new Set(graph.nodes.map((node) => node.id)); const errors: string[] = [];
  if (ids.size !== graph.nodes.length) errors.push('duplicate node id');
  for (const node of graph.nodes) for (const dependency of node.dependsOn) { if (!ids.has(dependency)) errors.push(`${node.id} depends on missing ${dependency}`); if (dependency === node.id) errors.push(`${node.id} depends on itself`); }
  const visit = (id: string, visiting = new Set<string>(), visited = new Set<string>()): boolean => { if (visiting.has(id)) return true; if (visited.has(id)) return false; visiting.add(id); const node = graph.nodes.find((n) => n.id === id); const cycle = node?.dependsOn.some((dep) => visit(dep, visiting, visited)) ?? false; visiting.delete(id); visited.add(id); return cycle; };
  if (graph.nodes.some((node) => visit(node.id))) errors.push('cycle detected');
  return errors;
}
