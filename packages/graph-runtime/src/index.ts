import type { WorkflowGraph } from '@roleflock/graph-core';
import { validateGraph } from '@roleflock/graph-core';
export interface NodeResult { nodeId: string; status: 'completed' | 'failed' | 'skipped'; output?: unknown; error?: unknown; }
export async function runSequentialGraph(graph: WorkflowGraph, execute: (nodeId: string, completed: readonly NodeResult[]) => Promise<unknown>): Promise<NodeResult[]> {
  const errors = validateGraph(graph); if (errors.length) throw new Error(`Invalid graph: ${errors.join(', ')}`);
  const pending = new Map(graph.nodes.map((node) => [node.id, node])); const results: NodeResult[] = [];
  while (pending.size) {
    const ready = [...pending.values()].find((node) => node.dependsOn.every((id) => results.some((r) => r.nodeId === id && r.status === 'completed')));
    if (!ready) { for (const node of pending.values()) results.push({ nodeId: node.id, status: 'skipped', error: 'dependency failed' }); break; }
    pending.delete(ready.id);
    try { results.push({ nodeId: ready.id, status: 'completed', output: await execute(ready.id, results) }); } catch (error) { results.push({ nodeId: ready.id, status: 'failed', error }); }
  }
  return results;
}
