import {
  RunnerIdentitySchema,
  type RunnerIdentity,
  type RunnerIdentityStore,
} from '@roleflock/change-passport';
import type { SqliteDb } from '../client.js';

export class RunnerIdentityRepository implements RunnerIdentityStore {
  constructor(private readonly db: SqliteDb) {}

  create(identity: RunnerIdentity, createdAt = new Date().toISOString()): RunnerIdentity {
    const parsed = RunnerIdentitySchema.parse(identity);
    this.db
      .prepare(
        `INSERT INTO runner_identities (
           id, kind, algorithm, key_id, key_reference, public_key, issuer,
           valid_from, valid_until, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.id,
        parsed.kind,
        parsed.algorithm,
        parsed.keyId,
        parsed.keyReference,
        parsed.publicKey,
        parsed.issuer ?? null,
        parsed.validFrom,
        parsed.validUntil ?? null,
        parsed.status,
        createdAt,
      );
    return parsed;
  }

  getActiveLocal(): RunnerIdentity | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM runner_identities
         WHERE kind = 'local_installation' AND status = 'active'
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get() as Record<string, unknown> | undefined;
    return row ? fromRow(row) : undefined;
  }

  get(id: string): RunnerIdentity | undefined {
    const row = this.db.prepare(`SELECT * FROM runner_identities WHERE id = ?`).get(id) as
      Record<string, unknown> | undefined;
    return row ? fromRow(row) : undefined;
  }
}

function fromRow(row: Record<string, unknown>): RunnerIdentity {
  return RunnerIdentitySchema.parse({
    id: row.id,
    kind: row.kind,
    algorithm: row.algorithm,
    keyId: row.key_id,
    keyReference: row.key_reference,
    publicKey: row.public_key,
    issuer: row.issuer ?? undefined,
    validFrom: row.valid_from,
    validUntil: row.valid_until ?? undefined,
    status: row.status,
  });
}
