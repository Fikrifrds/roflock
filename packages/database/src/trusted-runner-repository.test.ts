import { afterEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type SqliteDb } from './client.js';
import { TrustedRunnerRepository } from './repositories/trusted-runner-repository.js';

let db: SqliteDb | undefined;
afterEach(() => db?.close());

describe('trusted runner registration and rotation', () => {
  it('rotates trust atomically and rejects issuance by revoked runners', () => {
    db = openDatabase({ path: ':memory:' });
    migrate(db);
    seed(db);
    const repository = new TrustedRunnerRepository(db);
    const at = '2026-07-28T12:00:00.000Z';
    repository.register(runner('trusted_1', 'runner_identity_1', at));
    expect(repository.canIssue('org_1', 'runner_identity_1', 'project_1')).toMatchObject({
      allowed: true,
    });
    repository.rotate({
      currentId: 'trusted_1',
      replacement: runner('trusted_2', 'runner_identity_2', '2026-07-28T13:00:00.000Z'),
      actorId: 'actor_1',
      rotatedAt: '2026-07-28T13:00:00.000Z',
    });
    expect(repository.canIssue('org_1', 'runner_identity_1')).toMatchObject({
      allowed: false,
    });
    expect(repository.canIssue('org_1', 'runner_identity_2')).toMatchObject({
      allowed: true,
    });
    repository.revoke('trusted_2', 'actor_1', 'Runner compromised', '2026-07-28T14:00:00.000Z');
    expect(repository.canIssue('org_1', 'runner_identity_2')).toMatchObject({
      allowed: false,
      reason: 'Runner trust or signing identity is not active.',
    });
  });
});

function runner(id: string, runnerIdentityId: string, at: string) {
  return {
    id,
    organisationId: 'org_1',
    runnerIdentityId,
    actorId: 'actor_1',
    trustScope: { projectIds: ['project_1'], repositoryIds: [] },
    status: 'active' as const,
    registeredBy: 'actor_1',
    registeredAt: at,
    updatedAt: at,
  };
}

function seed(database: SqliteDb): void {
  const at = '2026-07-28T12:00:00.000Z';
  database
    .prepare(
      `INSERT INTO projects (
         id, workspace_id, name, repository_path, resolved_path, base_branch,
         status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run('project_1', 'workspace_1', 'Core', '/repo', '/repo', 'main', 'active', at, at);
  database
    .prepare(
      `INSERT INTO organisations (id, slug, name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run('org_1', 'roleflock', 'RoleFlock', 'active', at, at);
  database
    .prepare(
      `INSERT INTO actors (
         id, actor_type, display_name, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run('actor_1', 'human', 'Admin', 'active', at, at);
  for (const identity of ['runner_identity_1', 'runner_identity_2']) {
    database
      .prepare(
        `INSERT INTO runner_identities (
           id, kind, algorithm, key_id, key_reference, public_key, issuer,
           valid_from, status, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        identity,
        'organisation_runner',
        'ed25519',
        `key_${identity}`,
        `secret.${identity}`,
        '-----BEGIN PUBLIC KEY-----\nfixture\n-----END PUBLIC KEY-----',
        'org_1',
        at,
        'active',
        at,
      );
  }
}
