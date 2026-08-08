import type { SqliteDb } from '../client.js';

export interface InvocationRecord {
  id: string;
  nodeRunId: string;
  providerConnectionId: string;
  configuredModelId: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  outcome?: string;
  errorJson?: string;
  disclosureManifestId?: string;
  /** Stable identity for this turn; see `stableInvocationKey`. */
  idempotencyKey?: string;
}

export class InvocationRepository {
  constructor(private readonly db: SqliteDb) {}

  create(record: InvocationRecord): InvocationRecord {
    this.db
      .prepare(
        `INSERT INTO invocations
          (id, node_run_id, provider_connection_id, configured_model_id, status, started_at, completed_at, outcome, error_json, disclosure_manifest_id, idempotency_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.nodeRunId,
        record.providerConnectionId,
        record.configuredModelId,
        record.status,
        record.startedAt,
        record.completedAt ?? null,
        record.outcome ?? null,
        record.errorJson ?? null,
        record.disclosureManifestId ?? null,
        record.idempotencyKey ?? null,
      );
    return record;
  }

  /**
   * The turn already recorded under this identity, if any.
   *
   * A resumed run uses this to tell work that was already paid for from work
   * that never started. An entry whose outcome is OUTCOME_UNKNOWN is
   * deliberately still returned: unknown is not permission to repeat.
   */
  findByIdempotencyKey(key: string): InvocationRecord | undefined {
    const row = this.db.prepare('SELECT * FROM invocations WHERE idempotency_key = ?').get(key) as
      Record<string, unknown> | undefined;
    if (row === undefined) return undefined;
    return {
      id: String(row['id']),
      nodeRunId: String(row['node_run_id']),
      providerConnectionId: String(row['provider_connection_id']),
      configuredModelId: String(row['configured_model_id']),
      status: String(row['status']),
      startedAt: String(row['started_at']),
      ...(row['completed_at'] == null ? {} : { completedAt: String(row['completed_at']) }),
      ...(row['outcome'] == null ? {} : { outcome: String(row['outcome']) }),
      ...(row['error_json'] == null ? {} : { errorJson: String(row['error_json']) }),
      ...(row['disclosure_manifest_id'] == null
        ? {}
        : { disclosureManifestId: String(row['disclosure_manifest_id']) }),
      idempotencyKey: key,
    };
  }

  updateStatus(
    id: string,
    status: string,
    outcome?: string,
    completedAt?: string,
    errorJson?: string,
  ): void {
    this.db
      .prepare(
        `UPDATE invocations
         SET status = ?, outcome = COALESCE(?, outcome), completed_at = COALESCE(?, completed_at), error_json = COALESCE(?, error_json)
         WHERE id = ?`,
      )
      .run(status, outcome ?? null, completedAt ?? null, errorJson ?? null, id);
  }

  get(id: string): InvocationRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM invocations WHERE id = ?`).get(id) as
      Record<string, unknown> | undefined;
    return row ? mapInvocation(row) : undefined;
  }

  listByNodeRun(nodeRunId: string): InvocationRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM invocations WHERE node_run_id = ? ORDER BY started_at ASC`)
      .all(nodeRunId) as Array<Record<string, unknown>>;
    return rows.map(mapInvocation);
  }
}

function mapInvocation(row: Record<string, unknown>): InvocationRecord {
  return {
    id: String(row.id),
    nodeRunId: String(row.node_run_id),
    providerConnectionId: String(row.provider_connection_id),
    configuredModelId: String(row.configured_model_id),
    status: String(row.status),
    startedAt: String(row.started_at),
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    outcome: row.outcome ? String(row.outcome) : undefined,
    errorJson: row.error_json ? String(row.error_json) : undefined,
    disclosureManifestId: row.disclosure_manifest_id
      ? String(row.disclosure_manifest_id)
      : undefined,
  };
}
