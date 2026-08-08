import { createHash } from 'node:crypto';
import type { Task } from '@roleflock/contracts';
import {
  TaskRepository,
  WorkflowSnapshotRepository,
  type SqliteDb,
  type WorkflowSnapshotRecord,
} from '@roleflock/database';
import { semanticHash, validateGraphIR, type GraphIR } from '@roleflock/graph-ir';
import {
  registeredWorkflowIr,
  registeredWorkflowSource,
  validateGraph,
  type WorkflowGraph,
} from '@roleflock/graph-core';

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

/** Captures both authored identity and the exact graph the current runtime executes. */
export function workflowSnapshotRecord(input: {
  taskId: string;
  graph: WorkflowGraph;
  ir?: GraphIR;
  source?: string;
  createdAt: string;
}): WorkflowSnapshotRecord {
  const workflowGraphJson = JSON.stringify(input.graph);
  const semantic = input.graph.semanticHash ?? input.ir?.workflow.semanticHash;
  if (input.ir !== undefined && semantic !== undefined && semanticHash(input.ir) !== semantic) {
    throw new Error(`Workflow IR does not match semantic identity ${semantic}`);
  }

  return {
    taskId: input.taskId,
    graphVersionId: input.graph.version,
    ...(semantic === undefined ? {} : { semanticHash: semantic }),
    graphSnapshotHash: sha256(workflowGraphJson),
    ...(input.source === undefined ? {} : { source: input.source }),
    ...(input.ir === undefined ? {} : { graphIrJson: JSON.stringify(input.ir) }),
    workflowGraphJson,
    createdAt: input.createdAt,
  };
}

/**
 * Loads a stored execution graph and verifies every identity before returning
 * it. A corrupt snapshot fails closed; consulting the mutable template registry
 * would make the task silently run different code.
 */
export function workflowGraphFromSnapshot(
  task: Task,
  snapshot: WorkflowSnapshotRecord,
): WorkflowGraph {
  if (snapshot.taskId !== task.id) throw new Error('Workflow snapshot belongs to another task');
  if (snapshot.graphVersionId !== task.workflowGraphVersionId) {
    throw new Error(
      `Workflow snapshot version ${snapshot.graphVersionId} does not match task version ${task.workflowGraphVersionId}`,
    );
  }
  if (sha256(snapshot.workflowGraphJson) !== snapshot.graphSnapshotHash) {
    throw new Error(`Workflow snapshot for task ${task.id} failed its integrity check`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshot.workflowGraphJson);
  } catch {
    throw new Error(`Workflow snapshot for task ${task.id} is not valid JSON`);
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { nodes?: unknown }).nodes) ||
    !Array.isArray((parsed as { edges?: unknown }).edges)
  ) {
    throw new Error(`Workflow snapshot for task ${task.id} is not a runtime graph`);
  }

  const graph = parsed as WorkflowGraph;
  if (graph.version !== snapshot.graphVersionId) {
    throw new Error(`Workflow snapshot for task ${task.id} changed its version identity`);
  }
  if (graph.semanticHash !== snapshot.semanticHash) {
    throw new Error(`Workflow snapshot for task ${task.id} changed its semantic identity`);
  }
  const errors = validateGraph(graph);
  if (errors.length > 0) {
    throw new Error(`Invalid workflow snapshot for task ${task.id}: ${errors.join(', ')}`);
  }
  return graph;
}

/** Returns the exact authored IR kept with the task, never the current registry entry. */
export function workflowIrFromSnapshot(snapshot: WorkflowSnapshotRecord): GraphIR | undefined {
  if (snapshot.graphIrJson === undefined) return undefined;
  const parsed = JSON.parse(snapshot.graphIrJson) as GraphIR;
  const diagnostics = validateGraphIR(parsed).filter(
    (diagnostic) => diagnostic.severity === 'error',
  );
  if (diagnostics.length > 0) {
    throw new Error(`Invalid Graph IR snapshot: ${diagnostics.map((d) => d.message).join(', ')}`);
  }
  if (snapshot.semanticHash !== undefined && semanticHash(parsed) !== snapshot.semanticHash) {
    throw new Error('Graph IR snapshot failed its semantic identity check');
  }
  return parsed;
}

/**
 * Existing databases cannot recover a template as it looked before this
 * migration. On the first upgraded boot, freeze the semantics they can still
 * resolve so all subsequent boots are stable. Historical v1/v2 graphs retain
 * their hard-coded definitions and intentionally have no invented source IR.
 */
export function backfillWorkflowSnapshots(
  db: SqliteDb,
  resolveLegacy: (task: Task) => WorkflowGraph,
  createdAt = new Date().toISOString(),
): number {
  const tasks = new TaskRepository(db);
  const snapshots = new WorkflowSnapshotRepository(db);
  let created = 0;
  for (const task of tasks.list()) {
    if (snapshots.has(task.id)) continue;
    const graph = resolveLegacy(task);
    const candidateIr = registeredWorkflowIr(graph.version);
    const ir =
      candidateIr !== undefined &&
      graph.semanticHash !== undefined &&
      semanticHash(candidateIr) === graph.semanticHash
        ? candidateIr
        : undefined;
    const source = ir === undefined ? undefined : registeredWorkflowSource(graph.version);
    snapshots.create(
      workflowSnapshotRecord({
        taskId: task.id,
        graph,
        ...(ir === undefined ? {} : { ir }),
        ...(source === undefined ? {} : { source }),
        createdAt,
      }),
    );
    created += 1;
  }
  return created;
}
