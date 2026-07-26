import type { WorkflowGraph } from '@roleflock/graph-core';
import { validateGraph } from '@roleflock/graph-core';

export interface NodeResult {
  nodeId: string;
  status: 'completed' | 'failed' | 'skipped';
  output?: unknown;
  error?: unknown;
  attempt?: number;
}

/**
 * Execute a dependency-ordered graph. When `maxNodeAttempts` > 1, a failed
 * node may retry before the graph marks it failed (bounded fix/verify loops).
 */
export async function runSequentialGraph(
  graph: WorkflowGraph,
  execute: (nodeId: string, completed: readonly NodeResult[], attempt: number) => Promise<unknown>,
  options: { maxNodeAttempts?: number } = {},
): Promise<NodeResult[]> {
  const errors = validateGraph(graph);
  if (errors.length) throw new Error(`Invalid graph: ${errors.join(', ')}`);
  const maxNodeAttempts = Math.max(1, options.maxNodeAttempts ?? 1);
  const pending = new Map(graph.nodes.map((node) => [node.id, node]));
  const results: NodeResult[] = [];

  while (pending.size) {
    const ready = [...pending.values()].find((node) =>
      node.dependsOn.every((id) =>
        results.some((r) => r.nodeId === id && r.status === 'completed'),
      ),
    );
    if (!ready) {
      for (const node of pending.values()) {
        results.push({ nodeId: node.id, status: 'skipped', error: 'dependency failed' });
      }
      break;
    }
    pending.delete(ready.id);

    let lastError: unknown;
    let completed = false;
    for (let attempt = 1; attempt <= maxNodeAttempts; attempt += 1) {
      try {
        const output = await execute(ready.id, results, attempt);
        results.push({ nodeId: ready.id, status: 'completed', output, attempt });
        completed = true;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!completed) {
      results.push({
        nodeId: ready.id,
        status: 'failed',
        error: lastError,
        attempt: maxNodeAttempts,
      });
    }
  }
  return results;
}
