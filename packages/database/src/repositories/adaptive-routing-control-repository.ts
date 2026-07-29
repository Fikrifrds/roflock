import type { SqliteDb } from '../client.js';

export interface AdaptiveRoutingControl {
  id: string;
  organisationId?: string;
  projectId?: string;
  targetType: 'observation' | 'cohort' | 'model' | 'routing';
  targetId: string;
  action: 'exclude' | 'include' | 'freeze' | 'unfreeze' | 'override' | 'clear_override';
  value?: Record<string, unknown>;
  reason: string;
  actorId: string;
  createdAt: string;
}

export class AdaptiveRoutingControlRepository {
  constructor(private readonly db: SqliteDb) {}

  create(value: AdaptiveRoutingControl): AdaptiveRoutingControl {
    this.db
      .prepare(
        `INSERT INTO adaptive_routing_controls (
           id, organisation_id, project_id, target_type, target_id, action,
           value_json, reason, actor_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.id,
        value.organisationId ?? null,
        value.projectId ?? null,
        value.targetType,
        value.targetId,
        value.action,
        value.value ? JSON.stringify(value.value) : null,
        value.reason,
        value.actorId,
        value.createdAt,
      );
    return value;
  }

  effective(
    targetType: AdaptiveRoutingControl['targetType'],
    targetId: string,
  ): AdaptiveRoutingControl | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM adaptive_routing_controls
         WHERE target_type = ? AND target_id = ?
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(targetType, targetId) as Record<string, unknown> | undefined;
    return row ? mapControl(row) : undefined;
  }

  history(
    targetType: AdaptiveRoutingControl['targetType'],
    targetId: string,
  ): AdaptiveRoutingControl[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM adaptive_routing_controls
           WHERE target_type = ? AND target_id = ?
           ORDER BY created_at ASC, rowid ASC`,
        )
        .all(targetType, targetId) as Array<Record<string, unknown>>
    ).map(mapControl);
  }
}

function mapControl(row: Record<string, unknown>): AdaptiveRoutingControl {
  return {
    id: String(row.id),
    organisationId: row.organisation_id ? String(row.organisation_id) : undefined,
    projectId: row.project_id ? String(row.project_id) : undefined,
    targetType: row.target_type as AdaptiveRoutingControl['targetType'],
    targetId: String(row.target_id),
    action: row.action as AdaptiveRoutingControl['action'],
    value: row.value_json
      ? (JSON.parse(String(row.value_json)) as Record<string, unknown>)
      : undefined,
    reason: String(row.reason),
    actorId: String(row.actor_id),
    createdAt: String(row.created_at),
  };
}
