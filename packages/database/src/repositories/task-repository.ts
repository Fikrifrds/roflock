import type { Task } from '@roleflock/contracts';
import type { SqliteDb } from '../client.js';

export class TaskRepository {
  constructor(private readonly db: SqliteDb) {}

  upsert(task: Task): Task {
    this.db
      .prepare(
        `INSERT INTO tasks
          (id, project_id, type, title, brief, risk, state, workflow_graph_version_id, budget_policy_id,
           expected_behaviour, actual_behaviour, max_attempts, max_actual_cost_usd, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           state = excluded.state,
           updated_at = excluded.updated_at,
           title = excluded.title,
           brief = excluded.brief`,
      )
      .run(
        task.id,
        task.projectId,
        task.type,
        task.title,
        task.brief,
        task.risk,
        task.state,
        task.workflowGraphVersionId,
        task.budgetPolicyId,
        task.expectedBehaviour ?? null,
        task.actualBehaviour ?? null,
        task.maxAttempts,
        task.maxActualCostUsd ?? null,
        task.createdAt,
        task.updatedAt,
      );
    return task;
  }

  get(id: string): Task | undefined {
    const row = this.db
      .prepare(
        `SELECT id, project_id, type, title, brief, risk, state, workflow_graph_version_id, budget_policy_id,
                expected_behaviour, actual_behaviour, max_attempts, max_actual_cost_usd, created_at, updated_at
         FROM tasks WHERE id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapTask(row) : undefined;
  }

  list(projectId?: string): Task[] {
    const rows = projectId
      ? (this.db
          .prepare(
            `SELECT id, project_id, type, title, brief, risk, state, workflow_graph_version_id, budget_policy_id,
                    expected_behaviour, actual_behaviour, max_attempts, max_actual_cost_usd, created_at, updated_at
             FROM tasks WHERE project_id = ? ORDER BY created_at DESC`,
          )
          .all(projectId) as Array<Record<string, unknown>>)
      : (this.db
          .prepare(
            `SELECT id, project_id, type, title, brief, risk, state, workflow_graph_version_id, budget_policy_id,
                    expected_behaviour, actual_behaviour, max_attempts, max_actual_cost_usd, created_at, updated_at
             FROM tasks ORDER BY created_at DESC`,
          )
          .all() as Array<Record<string, unknown>>);
    return rows.map(mapTask);
  }
}

function mapTask(row: Record<string, unknown>): Task {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    type: row.type as Task['type'],
    title: String(row.title),
    brief: String(row.brief),
    risk: row.risk as Task['risk'],
    state: row.state as Task['state'],
    workflowGraphVersionId: String(row.workflow_graph_version_id),
    budgetPolicyId: String(row.budget_policy_id),
    expectedBehaviour: row.expected_behaviour ? String(row.expected_behaviour) : undefined,
    actualBehaviour: row.actual_behaviour ? String(row.actual_behaviour) : undefined,
    maxAttempts: Number(row.max_attempts),
    maxActualCostUsd:
      row.max_actual_cost_usd === null || row.max_actual_cost_usd === undefined
        ? undefined
        : Number(row.max_actual_cost_usd),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
