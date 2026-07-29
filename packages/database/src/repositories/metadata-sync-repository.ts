import { sha256Canonical } from '@roleflock/contracts';
import type { SqliteDb } from '../client.js';

export interface MetadataSyncBatch {
  id: string;
  organisationId: string;
  installationId: string;
  cursor: string;
  envelopeHash: string;
  envelope: Record<string, unknown>;
  status: 'queued' | 'synced' | 'failed';
  attempts: number;
  lastError?: string;
  createdAt: string;
  syncedAt?: string;
}

const FORBIDDEN_KEYS = new Set([
  'source',
  'sourceCode',
  'diff',
  'patch',
  'prompt',
  'transcript',
  'secret',
  'token',
  'credential',
]);

export class MetadataSyncRepository {
  constructor(private readonly db: SqliteDb) {}

  enqueue(value: MetadataSyncBatch): MetadataSyncBatch {
    assertMetadataOnly(value.envelope);
    const { envelopeHash: _hash, hashAlgorithm: _algorithm, ...unsigned } = value.envelope;
    if (sha256Canonical(unsigned) !== value.envelopeHash) {
      throw new Error('Metadata sync envelope hash is invalid');
    }
    this.db
      .prepare(
        `INSERT INTO metadata_sync_batches (
           id, organisation_id, installation_id, cursor, envelope_hash, envelope_json,
           status, attempts, last_error, created_at, synced_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        value.id,
        value.organisationId,
        value.installationId,
        value.cursor,
        value.envelopeHash,
        JSON.stringify(value.envelope),
        value.status,
        value.attempts,
        value.lastError ?? null,
        value.createdAt,
        value.syncedAt ?? null,
      );
    return value;
  }

  acknowledge(
    id: string,
    remoteCursor: string,
    syncedAt: string,
  ): MetadataSyncBatch | undefined {
    return this.db.transaction(() => {
      const batch = this.get(id);
      if (!batch) return undefined;
      this.db
        .prepare(
          `UPDATE metadata_sync_batches
           SET status = 'synced', attempts = attempts + 1, synced_at = ?, last_error = NULL
           WHERE id = ?`,
        )
        .run(syncedAt, id);
      this.db
        .prepare(
          `INSERT INTO metadata_sync_checkpoints (
             organisation_id, installation_id, remote_cursor, envelope_hash, updated_at
           ) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(organisation_id, installation_id) DO UPDATE SET
             remote_cursor = excluded.remote_cursor,
             envelope_hash = excluded.envelope_hash,
             updated_at = excluded.updated_at`,
        )
        .run(
          batch.organisationId,
          batch.installationId,
          remoteCursor,
          batch.envelopeHash,
          syncedAt,
        );
      return this.get(id);
    })();
  }

  get(id: string): MetadataSyncBatch | undefined {
    const row = this.db.prepare(`SELECT * FROM metadata_sync_batches WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapBatch(row) : undefined;
  }
}

function assertMetadataOnly(value: unknown, key?: string): void {
  if (key && FORBIDDEN_KEYS.has(key)) {
    throw new Error(`Metadata sync cannot contain ${key}`);
  }
  if (Array.isArray(value)) {
    for (const item of value) assertMetadataOnly(item);
  } else if (value && typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
      assertMetadataOnly(child, childKey);
    }
  }
}

function mapBatch(row: Record<string, unknown>): MetadataSyncBatch {
  return {
    id: String(row.id),
    organisationId: String(row.organisation_id),
    installationId: String(row.installation_id),
    cursor: String(row.cursor),
    envelopeHash: String(row.envelope_hash),
    envelope: JSON.parse(String(row.envelope_json)) as Record<string, unknown>,
    status: row.status as MetadataSyncBatch['status'],
    attempts: Number(row.attempts),
    lastError: row.last_error ? String(row.last_error) : undefined,
    createdAt: String(row.created_at),
    syncedAt: row.synced_at ? String(row.synced_at) : undefined,
  };
}
