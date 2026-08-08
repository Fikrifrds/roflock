import type { SqliteDb } from '../client.js';

/** Immutable authoring and execution identity captured when a task is created. */
export interface WorkflowSnapshotRecord {
  taskId: string;
  graphVersionId: string;
  semanticHash?: string;
  graphSnapshotHash: string;
  source?: string;
  graphIrJson?: string;
  workflowGraphJson: string;
  createdAt: string;
}

export class WorkflowSnapshotRepository {
  constructor(private readonly db: SqliteDb) {}

  /**
   * Inserts once. There is intentionally no update path: changing this row
   * would rewrite the meaning of an existing task.
   */
  create(record: WorkflowSnapshotRecord): WorkflowSnapshotRecord {
    this.db
      .prepare(
        `INSERT INTO workflow_snapshots
          (task_id, graph_version_id, semantic_hash, graph_snapshot_hash, source,
           graph_ir_json, workflow_graph_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.taskId,
        record.graphVersionId,
        record.semanticHash ?? null,
        record.graphSnapshotHash,
        record.source ?? null,
        record.graphIrJson ?? null,
        record.workflowGraphJson,
        record.createdAt,
      );
    return record;
  }

  get(taskId: string): WorkflowSnapshotRecord | undefined {
    const row = this.db
      .prepare('SELECT * FROM workflow_snapshots WHERE task_id = ?')
      .get(taskId) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : mapWorkflowSnapshot(row);
  }

  has(taskId: string): boolean {
    return (
      this.db.prepare('SELECT 1 FROM workflow_snapshots WHERE task_id = ?').get(taskId) !==
      undefined
    );
  }
}

function mapWorkflowSnapshot(row: Record<string, unknown>): WorkflowSnapshotRecord {
  return {
    taskId: String(row.task_id),
    graphVersionId: String(row.graph_version_id),
    graphSnapshotHash: String(row.graph_snapshot_hash),
    workflowGraphJson: String(row.workflow_graph_json),
    createdAt: String(row.created_at),
    ...(row.semantic_hash === null ? {} : { semanticHash: String(row.semantic_hash) }),
    ...(row.source === null ? {} : { source: String(row.source) }),
    ...(row.graph_ir_json === null ? {} : { graphIrJson: String(row.graph_ir_json) }),
  };
}
