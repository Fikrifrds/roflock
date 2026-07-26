import type { SqliteDb } from '../client.js';

export interface AuditEvent {
  id: string;
  actor: string;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

export class AuditRepository {
  constructor(private readonly db: SqliteDb) {}

  append(event: AuditEvent): AuditEvent {
    this.db
      .prepare(
        `INSERT INTO audit_events
          (id, actor, action, target_type, target_id, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.actor,
        event.action,
        event.targetType ?? null,
        event.targetId ?? null,
        event.details ? JSON.stringify(event.details) : null,
        event.createdAt,
      );
    return event;
  }

  list(limit = 500): AuditEvent[] {
    const rows = this.db
      .prepare(`SELECT * FROM audit_events ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map(mapAudit);
  }

  listByTarget(targetType: string, targetId: string): AuditEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM audit_events
         WHERE target_type = ? AND target_id = ?
         ORDER BY created_at ASC`,
      )
      .all(targetType, targetId) as Array<Record<string, unknown>>;
    return rows.map(mapAudit);
  }
}

function mapAudit(row: Record<string, unknown>): AuditEvent {
  return {
    id: String(row.id),
    actor: String(row.actor),
    action: String(row.action),
    targetType: row.target_type ? String(row.target_type) : undefined,
    targetId: row.target_id ? String(row.target_id) : undefined,
    details: row.details_json
      ? (JSON.parse(String(row.details_json)) as Record<string, unknown>)
      : undefined,
    createdAt: String(row.created_at),
  };
}
