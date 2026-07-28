import type { FeedbackItem } from '@roleflock/role-protocol';
import type { SqliteDb } from '../client.js';

export type StoredFeedbackItem = FeedbackItem & {
  idempotencyKey: string;
  requestHash: string;
};

export class FeedbackRepository {
  constructor(private readonly db: SqliteDb) {}

  create(input: StoredFeedbackItem): StoredFeedbackItem {
    this.db
      .prepare(
        `INSERT INTO feedback_items (
           id, task_id, source_actor_id, text, classification,
           target_contract_hash, target_plan_hash, target_commit,
           status, routed_role, idempotency_key, request_hash, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.taskId,
        input.sourceActorId,
        input.text,
        input.classification,
        input.targetContractHash ?? null,
        input.targetPlanHash ?? null,
        input.targetCommit ?? null,
        input.status,
        input.routedRole,
        input.idempotencyKey,
        input.requestHash,
        input.createdAt,
        input.updatedAt,
      );
    return input;
  }

  getByIdempotencyKey(taskId: string, key: string): StoredFeedbackItem | undefined {
    const row = this.db
      .prepare(`SELECT * FROM feedback_items WHERE task_id = ? AND idempotency_key = ?`)
      .get(taskId, key) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : mapFeedback(row);
  }

  list(taskId: string): StoredFeedbackItem[] {
    return (
      this.db
        .prepare(`SELECT * FROM feedback_items WHERE task_id = ? ORDER BY created_at ASC`)
        .all(taskId) as Array<Record<string, unknown>>
    ).map(mapFeedback);
  }
}

function mapFeedback(row: Record<string, unknown>): StoredFeedbackItem {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    sourceActorId: String(row.source_actor_id),
    text: String(row.text),
    classification: String(row.classification) as FeedbackItem['classification'],
    targetContractHash:
      row.target_contract_hash === null ? undefined : String(row.target_contract_hash),
    targetPlanHash: row.target_plan_hash === null ? undefined : String(row.target_plan_hash),
    targetCommit: row.target_commit === null ? undefined : String(row.target_commit),
    status: String(row.status) as FeedbackItem['status'],
    routedRole: String(row.routed_role) as FeedbackItem['routedRole'],
    idempotencyKey: String(row.idempotency_key),
    requestHash: String(row.request_hash),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
