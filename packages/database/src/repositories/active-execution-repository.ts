import type { ActiveExecution } from '@roleflock/contracts';
import type { SqliteDb } from '../client.js';

export class ActiveExecutionRepository {
  constructor(private readonly db: SqliteDb) {}

  upsert(execution: ActiveExecution): void {
    this.db
      .prepare(
        `INSERT INTO active_executions (node_run_id, graph_run_id, task_id, projection_json, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(node_run_id) DO UPDATE SET
           projection_json = excluded.projection_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        execution.nodeRunId,
        execution.graphRunId,
        execution.taskId,
        JSON.stringify(execution),
        new Date().toISOString(),
      );
  }

  getByNodeRun(nodeRunId: string): ActiveExecution | undefined {
    const row = this.db
      .prepare(`SELECT projection_json FROM active_executions WHERE node_run_id = ?`)
      .get(nodeRunId) as { projection_json: string } | undefined;
    return row ? (JSON.parse(row.projection_json) as ActiveExecution) : undefined;
  }

  getByTask(taskId: string): ActiveExecution | undefined {
    const row = this.db
      .prepare(
        `SELECT projection_json FROM active_executions
         WHERE task_id = ?
         ORDER BY updated_at DESC LIMIT 1`,
      )
      .get(taskId) as { projection_json: string } | undefined;
    return row ? (JSON.parse(row.projection_json) as ActiveExecution) : undefined;
  }

  delete(nodeRunId: string): void {
    this.db.prepare(`DELETE FROM active_executions WHERE node_run_id = ?`).run(nodeRunId);
  }

  list(): ActiveExecution[] {
    const rows = this.db
      .prepare(`SELECT projection_json FROM active_executions ORDER BY updated_at DESC`)
      .all() as Array<{ projection_json: string }>;
    return rows.map((row) => JSON.parse(row.projection_json) as ActiveExecution);
  }
}
