import type { SqliteDb } from '../client.js';

export interface ControlCommandRecord {
  id: string;
  nodeRunId: string;
  commandType: string;
  commandVersion: number;
  status: 'requested' | 'acknowledged' | 'stopping' | 'completed' | 'failed';
  requestedAt: string;
  acknowledgedAt?: string;
  completedAt?: string;
  error?: string;
}

export class ControlCommandRepository {
  constructor(private readonly db: SqliteDb) {}

  create(record: ControlCommandRecord): ControlCommandRecord {
    this.db
      .prepare(
        `INSERT INTO control_commands
          (id, node_run_id, command_type, command_version, status, requested_at, acknowledged_at, completed_at, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.nodeRunId,
        record.commandType,
        record.commandVersion,
        record.status,
        record.requestedAt,
        record.acknowledgedAt ?? null,
        record.completedAt ?? null,
        record.error ?? null,
      );
    return record;
  }

  updateStatus(
    id: string,
    status: ControlCommandRecord['status'],
    fields: Partial<Pick<ControlCommandRecord, 'acknowledgedAt' | 'completedAt' | 'error'>> = {},
  ): void {
    this.db
      .prepare(
        `UPDATE control_commands
         SET status = ?,
             acknowledged_at = COALESCE(?, acknowledged_at),
             completed_at = COALESCE(?, completed_at),
             error = COALESCE(?, error)
         WHERE id = ?`,
      )
      .run(
        status,
        fields.acknowledgedAt ?? null,
        fields.completedAt ?? null,
        fields.error ?? null,
        id,
      );
  }

  get(id: string): ControlCommandRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM control_commands WHERE id = ?`).get(id) as
      Record<string, unknown> | undefined;
    return row ? mapControl(row) : undefined;
  }

  listByNode(nodeRunId: string): ControlCommandRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM control_commands WHERE node_run_id = ? ORDER BY requested_at ASC`)
      .all(nodeRunId) as Array<Record<string, unknown>>;
    return rows.map(mapControl);
  }
}

function mapControl(row: Record<string, unknown>): ControlCommandRecord {
  return {
    id: String(row.id),
    nodeRunId: String(row.node_run_id),
    commandType: String(row.command_type),
    commandVersion: Number(row.command_version),
    status: row.status as ControlCommandRecord['status'],
    requestedAt: String(row.requested_at),
    acknowledgedAt: row.acknowledged_at ? String(row.acknowledged_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    error: row.error ? String(row.error) : undefined,
  };
}
