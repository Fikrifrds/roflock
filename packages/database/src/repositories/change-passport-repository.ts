import {
  PassportRevocationSchema,
  SignedChangePassportSchema,
  type ChangePassportStore,
  type PassportRevocation,
  type StoredPassport,
} from '@roleflock/change-passport';
import type { SqliteDb } from '../client.js';

export class ChangePassportRepository implements ChangePassportStore {
  constructor(private readonly db: SqliteDb) {}

  create(record: StoredPassport, createdAt = new Date().toISOString()): StoredPassport {
    SignedChangePassportSchema.parse(record.envelope);
    this.db
      .prepare(
        `INSERT INTO change_passports (
           passport_id, task_id, result_commit, payload_digest, issuer_identity_id,
           verdict, envelope_json, issued_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.passportId,
        record.taskId,
        record.resultCommit,
        record.payloadDigest,
        record.issuerIdentityId,
        record.verdict,
        JSON.stringify(record.envelope),
        record.issuedAt,
        createdAt,
      );
    return record;
  }

  get(passportId: string): StoredPassport | undefined {
    const row = this.db
      .prepare(`SELECT * FROM change_passports WHERE passport_id = ?`)
      .get(passportId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      passportId: String(row.passport_id),
      taskId: String(row.task_id),
      resultCommit: String(row.result_commit),
      payloadDigest: String(row.payload_digest),
      issuerIdentityId: String(row.issuer_identity_id),
      verdict: String(row.verdict) as StoredPassport['verdict'],
      envelope: SignedChangePassportSchema.parse(JSON.parse(String(row.envelope_json))),
      issuedAt: String(row.issued_at),
    };
  }

  revoke(revocation: PassportRevocation): PassportRevocation {
    const parsed = PassportRevocationSchema.parse(revocation);
    this.db
      .prepare(
        `INSERT INTO passport_revocations (
           passport_id, payload_digest, reason, revoked_by, revoked_at, revocation_json
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        parsed.passportId,
        parsed.payloadDigest,
        parsed.reason,
        parsed.revokedBy,
        parsed.revokedAt,
        JSON.stringify(parsed),
      );
    return parsed;
  }

  getRevocation(passportId: string): PassportRevocation | undefined {
    const row = this.db
      .prepare(`SELECT revocation_json FROM passport_revocations WHERE passport_id = ?`)
      .get(passportId) as { revocation_json: string } | undefined;
    return row ? PassportRevocationSchema.parse(JSON.parse(row.revocation_json)) : undefined;
  }
}
