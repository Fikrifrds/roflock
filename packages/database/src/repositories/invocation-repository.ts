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
  driverId?: string;
  driverSessionId?: string;
  resumedFromInvocationId?: string;
  cancellationCapability?: string;
  interruptionJson?: string;
}

export class InvocationRepository {
  constructor(private readonly db: SqliteDb) {}

  create(record: InvocationRecord): InvocationRecord {
    this.db
      .prepare(
        `INSERT INTO invocations
          (id, node_run_id, provider_connection_id, configured_model_id, status, started_at, completed_at, outcome, error_json, disclosure_manifest_id, idempotency_key, driver_id, driver_session_id, resumed_from_invocation_id, cancellation_capability, interruption_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        record.driverId ?? null,
        record.driverSessionId ?? null,
        record.resumedFromInvocationId ?? null,
        record.cancellationCapability ?? null,
        record.interruptionJson ?? null,
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
    return mapInvocation(row);
  }

  updateDriver(
    id: string,
    input: {
      providerConnectionId: string;
      configuredModelId: string;
      driverId: string;
      cancellationCapability: string;
      resumedFromInvocationId?: string;
    },
  ): void {
    this.db
      .prepare(
        `UPDATE invocations
         SET provider_connection_id = ?, configured_model_id = ?, driver_id = ?,
             cancellation_capability = ?, resumed_from_invocation_id = ?
         WHERE id = ?`,
      )
      .run(
        input.providerConnectionId,
        input.configuredModelId,
        input.driverId,
        input.cancellationCapability,
        input.resumedFromInvocationId ?? null,
        id,
      );
  }

  recordDriverSession(id: string, sessionId: string): void {
    this.db.prepare('UPDATE invocations SET driver_session_id = ? WHERE id = ?').run(sessionId, id);
  }

  recordInterruption(id: string, value: unknown): void {
    this.db
      .prepare('UPDATE invocations SET interruption_json = ? WHERE id = ?')
      .run(JSON.stringify(value), id);
  }

  /**
   * A known, earlier session for a new attempt of the same workflow node.
   * Unknown outcomes are excluded: resume is context continuity, never
   * permission to repeat work whose completion could not be observed.
   */
  findLatestResumableSession(input: {
    taskId: string;
    nodeKey: string;
    driverId: string;
    providerConnectionId: string;
    configuredModelId: string;
    excludeInvocationId: string;
  }): InvocationRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT i.* FROM invocations i
         JOIN node_runs nr ON nr.id = i.node_run_id
         JOIN graph_runs gr ON gr.id = nr.graph_run_id
         WHERE gr.task_id = ? AND nr.node_key = ? AND i.driver_id = ?
           AND i.provider_connection_id = ? AND i.configured_model_id = ?
           AND i.driver_session_id IS NOT NULL AND i.id <> ?
           AND i.status IN ('completed', 'failed')
           AND COALESCE(i.outcome, '') <> 'OUTCOME_UNKNOWN'
         ORDER BY i.started_at DESC LIMIT 1`,
      )
      .get(
        input.taskId,
        input.nodeKey,
        input.driverId,
        input.providerConnectionId,
        input.configuredModelId,
        input.excludeInvocationId,
      ) as Record<string, unknown> | undefined;
    return row ? mapInvocation(row) : undefined;
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
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : undefined,
    driverId: row.driver_id ? String(row.driver_id) : undefined,
    driverSessionId: row.driver_session_id ? String(row.driver_session_id) : undefined,
    resumedFromInvocationId: row.resumed_from_invocation_id
      ? String(row.resumed_from_invocation_id)
      : undefined,
    cancellationCapability: row.cancellation_capability
      ? String(row.cancellation_capability)
      : undefined,
    interruptionJson: row.interruption_json ? String(row.interruption_json) : undefined,
  };
}
