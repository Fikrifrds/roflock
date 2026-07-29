import type { Task } from '@roleflock/contracts';
import type { SqliteDb } from '../client.js';

export class TaskRepository {
  constructor(private readonly db: SqliteDb) {}

  upsert(task: Task): Task {
    this.db
      .prepare(
        `INSERT INTO tasks
          (id, project_id, type, title, brief, risk, state, workflow_graph_version_id, budget_policy_id,
           contract_requirement, expected_behaviour, actual_behaviour, verification_command, max_attempts,
           max_actual_cost_usd, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           state = excluded.state,
           updated_at = excluded.updated_at,
           title = excluded.title,
           brief = excluded.brief,
           verification_command = excluded.verification_command`,
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
        task.contractRequirement ?? 'required',
        task.expectedBehaviour ?? null,
        task.actualBehaviour ?? null,
        task.verificationCommand ?? null,
        task.maxAttempts,
        task.maxActualCostUsd ?? null,
        task.createdAt,
        task.updatedAt,
      );
    return {
      ...task,
      contractRequirement: task.contractRequirement ?? 'required',
    };
  }

  get(id: string): Task | undefined {
    const row = this.db
      .prepare(
        `SELECT id, project_id, type, title, brief, risk, state, workflow_graph_version_id, budget_policy_id,
                contract_requirement, expected_behaviour, actual_behaviour, verification_command,
                max_attempts, max_actual_cost_usd, created_at, updated_at
         FROM tasks WHERE id = ?`,
      )
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapTask(row) : undefined;
  }

  updateVerificationCommand(
    id: string,
    verificationCommand: string | undefined,
    updatedAt: string,
  ): Task | undefined {
    this.db
      .prepare('UPDATE tasks SET verification_command = ?, updated_at = ? WHERE id = ?')
      .run(verificationCommand ?? null, updatedAt, id);
    return this.get(id);
  }

  /**
   * Removes a task and its local runtime rows. Event history stays append-only;
   * orphaned events are fine for audit and do not reappear in the inbox.
   */
  delete(id: string): boolean {
    const existing = this.get(id);
    if (!existing) return false;

    const runIds = (
      this.db.prepare(`SELECT id FROM graph_runs WHERE task_id = ?`).all(id) as Array<{
        id: string;
      }>
    ).map((row) => row.id);
    const nodeRunIds =
      runIds.length === 0
        ? []
        : (
            this.db
              .prepare(
                `SELECT id FROM node_runs WHERE graph_run_id IN (${runIds.map(() => '?').join(',')})`,
              )
              .all(...runIds) as Array<{ id: string }>
          ).map((row) => row.id);
    const confirmationIds = (
      this.db.prepare(`SELECT id FROM confirmation_requests WHERE task_id = ?`).all(id) as Array<{
        id: string;
      }>
    ).map((row) => row.id);

    const tx = this.db.transaction(() => {
      if (nodeRunIds.length) {
        const placeholders = nodeRunIds.map(() => '?').join(',');
        this.db
          .prepare(`DELETE FROM loop_attempts WHERE node_run_id IN (${placeholders})`)
          .run(...nodeRunIds);
        this.db
          .prepare(`DELETE FROM control_commands WHERE node_run_id IN (${placeholders})`)
          .run(...nodeRunIds);
        this.db
          .prepare(`DELETE FROM active_executions WHERE node_run_id IN (${placeholders})`)
          .run(...nodeRunIds);
        this.db
          .prepare(`DELETE FROM process_handles WHERE node_run_id IN (${placeholders})`)
          .run(...nodeRunIds);
        this.db
          .prepare(`DELETE FROM invocations WHERE node_run_id IN (${placeholders})`)
          .run(...nodeRunIds);
        this.db
          .prepare(
            `DELETE FROM runtime_leases WHERE resource_type = 'node_run' AND resource_id IN (${placeholders})`,
          )
          .run(...nodeRunIds);
        this.db.prepare(`DELETE FROM node_runs WHERE id IN (${placeholders})`).run(...nodeRunIds);
      }

      if (confirmationIds.length) {
        const placeholders = confirmationIds.map(() => '?').join(',');
        this.db
          .prepare(`DELETE FROM approvals WHERE confirmation_request_id IN (${placeholders})`)
          .run(...confirmationIds);
      }

      this.db.prepare(`DELETE FROM active_executions WHERE task_id = ?`).run(id);
      this.db.prepare(`DELETE FROM confirmation_requests WHERE task_id = ?`).run(id);
      this.db.prepare(`DELETE FROM worktrees WHERE task_id = ?`).run(id);
      this.db.prepare(`DELETE FROM usage_ledger_entries WHERE task_id = ?`).run(id);
      this.db.prepare(`DELETE FROM artefacts WHERE task_id = ?`).run(id);
      this.db.prepare(`DELETE FROM test_runs WHERE task_id = ?`).run(id);
      this.db.prepare(`DELETE FROM review_findings WHERE task_id = ?`).run(id);
      this.db.prepare(`DELETE FROM task_documents WHERE task_id = ?`).run(id);
      this.db.prepare(`DELETE FROM feedback_items WHERE task_id = ?`).run(id);
      this.db.prepare(`DELETE FROM task_role_assignments WHERE task_id = ?`).run(id);
      this.db.prepare(`DELETE FROM graph_runs WHERE task_id = ?`).run(id);
      this.db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id);
    });
    tx();
    return true;
  }

  list(projectId?: string): Task[] {
    const rows = projectId
      ? (this.db
          .prepare(
            `SELECT id, project_id, type, title, brief, risk, state, workflow_graph_version_id, budget_policy_id,
                    contract_requirement, expected_behaviour, actual_behaviour, verification_command,
                    max_attempts, max_actual_cost_usd, created_at, updated_at
             FROM tasks WHERE project_id = ? ORDER BY created_at DESC`,
          )
          .all(projectId) as Array<Record<string, unknown>>)
      : (this.db
          .prepare(
            `SELECT id, project_id, type, title, brief, risk, state, workflow_graph_version_id, budget_policy_id,
                    contract_requirement, expected_behaviour, actual_behaviour, verification_command,
                    max_attempts, max_actual_cost_usd, created_at, updated_at
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
    contractRequirement:
      String(row.contract_requirement) === 'legacy_uncontracted'
        ? 'legacy_uncontracted'
        : 'required',
    expectedBehaviour: row.expected_behaviour ? String(row.expected_behaviour) : undefined,
    actualBehaviour: row.actual_behaviour ? String(row.actual_behaviour) : undefined,
    verificationCommand: row.verification_command ? String(row.verification_command) : undefined,
    maxAttempts: Number(row.max_attempts),
    maxActualCostUsd:
      row.max_actual_cost_usd === null || row.max_actual_cost_usd === undefined
        ? undefined
        : Number(row.max_actual_cost_usd),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
