import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, migrate, type SqliteDb } from './client.js';
import { ChangePassportRepository } from './repositories/change-passport-repository.js';
import { RunnerIdentityRepository } from './repositories/runner-identity-repository.js';

let db: SqliteDb | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
});

describe('ChangePassportRepository', () => {
  it('persists immutable envelopes and append-only revocations', () => {
    db = openDatabase({ path: ':memory:' });
    migrate(db);
    const identities = new RunnerIdentityRepository(db);
    const passports = new ChangePassportRepository(db);
    const { publicKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    identities.create({
      id: 'runner_1',
      kind: 'local_installation',
      algorithm: 'ed25519',
      keyId: 'a'.repeat(64),
      keyReference: 'keychain.runner.1',
      publicKey,
      validFrom: '2026-07-28T10:00:00.000Z',
      status: 'active',
    });
    const envelope = {
      payloadType: 'application/vnd.roleflock.change-passport+json;version=1',
      payload: Buffer.from('{}').toString('base64'),
      signatures: [{ keyid: 'a'.repeat(64), sig: 'c2ln', algorithm: 'ed25519' as const }],
    };
    const record = {
      passportId: 'passport_1',
      taskId: 'task_1',
      resultCommit: '1'.repeat(40),
      payloadDigest: 'b'.repeat(64),
      issuerIdentityId: 'runner_1',
      verdict: 'pass' as const,
      envelope,
      issuedAt: '2026-07-28T10:00:00.000Z',
    };
    passports.create(record);
    expect(passports.get('passport_1')).toEqual(record);

    const revocation = {
      passportId: 'passport_1',
      payloadDigest: 'b'.repeat(64),
      reason: 'Escaped defect.',
      revokedBy: 'authority_1',
      revokedAt: '2026-07-28T11:00:00.000Z',
      signature: {
        payloadType: 'application/vnd.roleflock.change-passport-revocation+json;version=1',
        payload: Buffer.from('{}').toString('base64'),
        signatures: [{ keyid: 'a'.repeat(64), sig: 'c2ln', algorithm: 'ed25519' as const }],
      },
    };
    passports.revoke(revocation);
    expect(passports.getRevocation('passport_1')).toEqual(revocation);
    expect(() =>
      db!
        .prepare(`UPDATE change_passports SET verdict = 'fail' WHERE passport_id = ?`)
        .run('passport_1'),
    ).toThrow(/immutable/);
    expect(() =>
      db!.prepare(`DELETE FROM passport_revocations WHERE passport_id = ?`).run('passport_1'),
    ).toThrow(/immutable/);
  });
});
