import type { SqliteDb } from '../client.js';

export interface StateSnapshot {
  aggregateId: string;
  aggregateType: string;
  lastSequence: number;
  state: Record<string, unknown>;
  createdAt: string;
}

export class SnapshotRepository {
  constructor(private readonly db: SqliteDb) {}

  save(snapshot: StateSnapshot): void {
    this.db
      .prepare(
        `INSERT INTO state_snapshots (aggregate_id, aggregate_type, last_sequence, state_json, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(aggregate_id) DO UPDATE SET
           last_sequence = excluded.last_sequence,
           state_json = excluded.state_json,
           created_at = excluded.created_at`,
      )
      .run(
        snapshot.aggregateId,
        snapshot.aggregateType,
        snapshot.lastSequence,
        JSON.stringify(snapshot.state),
        snapshot.createdAt,
      );
  }

  get(aggregateId: string): StateSnapshot | undefined {
    const row = this.db
      .prepare(
        `SELECT aggregate_id, aggregate_type, last_sequence, state_json, created_at
         FROM state_snapshots WHERE aggregate_id = ?`,
      )
      .get(aggregateId) as
      | {
          aggregate_id: string;
          aggregate_type: string;
          last_sequence: number;
          state_json: string;
          created_at: string;
        }
      | undefined;

    if (!row) return undefined;
    return {
      aggregateId: row.aggregate_id,
      aggregateType: row.aggregate_type,
      lastSequence: row.last_sequence,
      state: JSON.parse(row.state_json) as Record<string, unknown>,
      createdAt: row.created_at,
    };
  }
}
