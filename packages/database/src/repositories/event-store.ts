import type { EventEnvelope } from '@roleflock/contracts';
import type { SqliteDb } from '../client.js';

export class EventStore {
  constructor(private readonly db: SqliteDb) {}

  append(event: EventEnvelope): EventEnvelope {
    const existing = event.metadata.idempotencyKey
      ? this.findByIdempotencyKey(event.aggregateId, event.metadata.idempotencyKey)
      : undefined;
    if (existing) {
      return existing;
    }

    const last = this.getLastSequence(event.aggregateId);
    if (event.sequence !== last + 1) {
      throw new Error(
        `Optimistic sequence conflict for ${event.aggregateId}: expected ${last + 1}, got ${event.sequence}`,
      );
    }

    try {
      this.db
        .prepare(
          `INSERT INTO events
            (id, aggregate_type, aggregate_id, sequence, event_type, payload_json, metadata_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          event.id,
          event.aggregateType,
          event.aggregateId,
          event.sequence,
          event.eventType,
          JSON.stringify(event.payload),
          JSON.stringify(event.metadata),
          event.createdAt,
        );
    } catch (error) {
      if (event.metadata.idempotencyKey) {
        const raced = this.findByIdempotencyKey(event.aggregateId, event.metadata.idempotencyKey);
        if (raced) return raced;
      }
      throw error;
    }

    return event;
  }

  getLastSequence(aggregateId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(sequence), 0) AS seq FROM events WHERE aggregate_id = ?')
      .get(aggregateId) as { seq: number } | undefined;
    return row?.seq ?? 0;
  }

  list(aggregateId: string, afterSequence = 0): EventEnvelope[] {
    const rows = this.db
      .prepare(
        `SELECT id, aggregate_type, aggregate_id, sequence, event_type, payload_json, metadata_json, created_at
         FROM events
         WHERE aggregate_id = ? AND sequence > ?
         ORDER BY sequence ASC`,
      )
      .all(aggregateId, afterSequence) as Array<{
      id: string;
      aggregate_type: string;
      aggregate_id: string;
      sequence: number;
      event_type: string;
      payload_json: string;
      metadata_json: string;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      sequence: row.sequence,
      eventType: row.event_type,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      metadata: JSON.parse(row.metadata_json) as EventEnvelope['metadata'],
      createdAt: row.created_at,
    }));
  }

  findByIdempotencyKey(aggregateId: string, idempotencyKey: string): EventEnvelope | undefined {
    const row = this.db
      .prepare(
        `SELECT id, aggregate_type, aggregate_id, sequence, event_type, payload_json, metadata_json, created_at
         FROM events
         WHERE aggregate_id = ?
           AND json_extract(metadata_json, '$.idempotencyKey') = ?
         LIMIT 1`,
      )
      .get(aggregateId, idempotencyKey) as
      | {
          id: string;
          aggregate_type: string;
          aggregate_id: string;
          sequence: number;
          event_type: string;
          payload_json: string;
          metadata_json: string;
          created_at: string;
        }
      | undefined;

    if (!row) return undefined;
    return {
      id: row.id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      sequence: row.sequence,
      eventType: row.event_type,
      payload: JSON.parse(row.payload_json) as Record<string, unknown>,
      metadata: JSON.parse(row.metadata_json) as EventEnvelope['metadata'],
      createdAt: row.created_at,
    };
  }

  /** Events are append-only — updates and deletes are intentionally unsupported. */
  update(): never {
    throw new Error('Event store is append-only; updates are forbidden');
  }

  delete(): never {
    throw new Error('Event store is append-only; deletes are forbidden');
  }
}
