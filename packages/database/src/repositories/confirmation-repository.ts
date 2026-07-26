import type { ConfirmationRequest } from '@roleflock/contracts';
import type { SqliteDb } from '../client.js';

export class ConfirmationRepository {
  constructor(private readonly db: SqliteDb) {}

  create(request: ConfirmationRequest): ConfirmationRequest {
    this.db
      .prepare(
        `INSERT INTO confirmation_requests
          (id, task_id, graph_run_id, node_run_id, request_type, rationale, exact_action_json,
           affected_paths_json, command_preview, destination, estimated_additional_cost,
           risk_class, state_hash, fingerprint, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        request.id,
        request.taskId,
        request.graphRunId,
        request.nodeRunId,
        request.requestType,
        request.rationale,
        JSON.stringify(request.exactAction),
        request.affectedPaths ? JSON.stringify(request.affectedPaths) : null,
        request.commandPreview ?? null,
        request.destination ?? null,
        request.estimatedAdditionalCost ?? null,
        request.riskClass,
        request.stateHash,
        request.fingerprint,
        request.status,
        request.createdAt,
      );
    return request;
  }

  listPending(): ConfirmationRequest[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM confirmation_requests WHERE status = 'pending' ORDER BY created_at ASC`,
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map(mapConfirmation);
  }

  get(id: string): ConfirmationRequest | undefined {
    const row = this.db
      .prepare(`SELECT * FROM confirmation_requests WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapConfirmation(row) : undefined;
  }

  setStatus(
    id: string,
    status: ConfirmationRequest['status'],
    decidedAt: string,
    note?: string,
  ): void {
    this.db
      .prepare(
        `UPDATE confirmation_requests
         SET status = ?, decided_at = ?, decision_note = ?
         WHERE id = ?`,
      )
      .run(status, decidedAt, note ?? null, id);
  }

  listByFingerprint(fingerprint: string, status = 'pending'): ConfirmationRequest[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM confirmation_requests
         WHERE fingerprint = ? AND status = ?
         ORDER BY created_at ASC`,
      )
      .all(fingerprint, status) as Array<Record<string, unknown>>;
    return rows.map(mapConfirmation);
  }
}

function mapConfirmation(row: Record<string, unknown>): ConfirmationRequest {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    graphRunId: String(row.graph_run_id),
    nodeRunId: String(row.node_run_id),
    requestType: row.request_type as ConfirmationRequest['requestType'],
    rationale: String(row.rationale),
    exactAction: JSON.parse(String(row.exact_action_json)),
    affectedPaths: row.affected_paths_json
      ? (JSON.parse(String(row.affected_paths_json)) as string[])
      : undefined,
    commandPreview: row.command_preview ? String(row.command_preview) : undefined,
    destination: row.destination ? String(row.destination) : undefined,
    estimatedAdditionalCost:
      row.estimated_additional_cost === null || row.estimated_additional_cost === undefined
        ? undefined
        : Number(row.estimated_additional_cost),
    riskClass: row.risk_class as ConfirmationRequest['riskClass'],
    stateHash: String(row.state_hash),
    fingerprint: String(row.fingerprint),
    status: row.status as ConfirmationRequest['status'],
    createdAt: String(row.created_at),
  };
}
