import type { SqliteDb } from '../client.js';

export interface ProcessHandleRecord {
  id: string;
  nodeRunId?: string;
  invocationId?: string;
  pid: number;
  pgid?: number;
  commandPreview?: string;
  startedAt: string;
  lastHeartbeatAt: string;
  status: 'running' | 'stopping' | 'terminated' | 'orphaned' | 'unknown';
  endedAt?: string;
}

export class ProcessHandleRepository {
  constructor(private readonly db: SqliteDb) {}

  create(record: ProcessHandleRecord): ProcessHandleRecord {
    this.db
      .prepare(
        `INSERT INTO process_handles
          (id, node_run_id, invocation_id, pid, pgid, command_preview, started_at, last_heartbeat_at, status, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.nodeRunId ?? null,
        record.invocationId ?? null,
        record.pid,
        record.pgid ?? null,
        record.commandPreview ?? null,
        record.startedAt,
        record.lastHeartbeatAt,
        record.status,
        record.endedAt ?? null,
      );
    return record;
  }

  heartbeat(id: string, at: string): void {
    this.db.prepare(`UPDATE process_handles SET last_heartbeat_at = ? WHERE id = ?`).run(at, id);
  }

  setStatus(id: string, status: ProcessHandleRecord['status'], endedAt?: string): void {
    this.db
      .prepare(
        `UPDATE process_handles SET status = ?, ended_at = COALESCE(?, ended_at) WHERE id = ?`,
      )
      .run(status, endedAt ?? null, id);
  }

  listRunning(): ProcessHandleRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM process_handles WHERE status IN ('running', 'stopping', 'orphaned')`)
      .all() as Array<Record<string, unknown>>;
    return rows.map(mapProcess);
  }

  get(id: string): ProcessHandleRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM process_handles WHERE id = ?`).get(id) as
      Record<string, unknown> | undefined;
    return row ? mapProcess(row) : undefined;
  }
}

function mapProcess(row: Record<string, unknown>): ProcessHandleRecord {
  return {
    id: String(row.id),
    nodeRunId: row.node_run_id ? String(row.node_run_id) : undefined,
    invocationId: row.invocation_id ? String(row.invocation_id) : undefined,
    pid: Number(row.pid),
    pgid: row.pgid === null || row.pgid === undefined ? undefined : Number(row.pgid),
    commandPreview: row.command_preview ? String(row.command_preview) : undefined,
    startedAt: String(row.started_at),
    lastHeartbeatAt: String(row.last_heartbeat_at),
    status: row.status as ProcessHandleRecord['status'],
    endedAt: row.ended_at ? String(row.ended_at) : undefined,
  };
}
