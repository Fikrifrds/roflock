import { sha256Canonical } from '@roleflock/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type SqliteDb } from './client.js';
import { MetadataSyncRepository } from './repositories/metadata-sync-repository.js';

let db: SqliteDb | undefined;
afterEach(() => db?.close());

describe('metadata-only hosted sync', () => {
  it('queues and checkpoints allowlisted metadata without source upload', () => {
    db = openDatabase({ path: ':memory:' });
    migrate(db);
    const at = '2026-07-28T12:00:00.000Z';
    db.prepare(
      `INSERT INTO organisations (id, slug, name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('org_1', 'roleflock', 'RoleFlock', 'active', at, at);
    const unsigned = {
      schemaVersion: 1,
      organisationId: 'org_1',
      installationId: 'installation_1',
      cursor: 'cursor_1',
      records: [{ type: 'task', taskId: 'task_1', state: 'VERIFYING' }],
      createdAt: at,
    };
    const envelope = {
      ...unsigned,
      hashAlgorithm: 'sha256',
      envelopeHash: sha256Canonical(unsigned),
    };
    const repository = new MetadataSyncRepository(db);
    repository.enqueue({
      id: 'batch_1',
      organisationId: 'org_1',
      installationId: 'installation_1',
      cursor: 'cursor_1',
      envelopeHash: envelope.envelopeHash,
      envelope,
      status: 'queued',
      attempts: 0,
      createdAt: at,
    });
    expect(repository.acknowledge('batch_1', 'remote_1', at)).toMatchObject({
      status: 'synced',
      attempts: 1,
    });
    expect(() =>
      repository.enqueue({
        id: 'batch_source',
        organisationId: 'org_1',
        installationId: 'installation_1',
        cursor: 'cursor_2',
        envelopeHash: 'a'.repeat(64),
        envelope: { sourceCode: 'private code' },
        status: 'queued',
        attempts: 0,
        createdAt: at,
      }),
    ).toThrow(/cannot contain sourceCode/);
  });
});
