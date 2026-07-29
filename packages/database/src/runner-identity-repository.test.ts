import { generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, migrate, type SqliteDb } from './client.js';
import { RunnerIdentityRepository } from './repositories/runner-identity-repository.js';

let db: SqliteDb | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
});

describe('RunnerIdentityRepository', () => {
  it('persists public identity metadata without any private-key column', () => {
    db = openDatabase({ path: ':memory:' });
    migrate(db);
    const repository = new RunnerIdentityRepository(db);
    const { publicKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const identity = repository.create({
      id: 'runner_local_1',
      kind: 'local_installation',
      algorithm: 'ed25519',
      keyId: 'a'.repeat(64),
      keyReference: 'roleflock.runner.local.key',
      publicKey,
      validFrom: '2026-07-28T10:00:00.000Z',
      status: 'active',
    });

    expect(repository.getActiveLocal()).toEqual(identity);
    const columns = db
      .prepare(`PRAGMA table_info(runner_identities)`)
      .all()
      .map((row) => String((row as { name: string }).name));
    expect(columns).toContain('public_key');
    expect(columns.some((column) => /private|secret/i.test(column))).toBe(false);
    expect(JSON.stringify(db.prepare(`SELECT * FROM runner_identities`).get())).not.toContain(
      'PRIVATE KEY',
    );
  });
});
