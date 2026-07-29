import { sha256Canonical } from '@roleflock/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type SqliteDb } from './client.js';
import { SharedPolicyRepository } from './repositories/shared-policy-repository.js';

let db: SqliteDb | undefined;
afterEach(() => db?.close());

describe('shared policies and scoped credentials', () => {
  it('resolves assigned bundles and exposes only scoped secret references', () => {
    db = openDatabase({ path: ':memory:' });
    migrate(db);
    seed(db);
    const repository = new SharedPolicyRepository(db);
    const at = '2026-07-28T12:00:00.000Z';
    const bundle = {
      schemaVersion: 1,
      policy: { deniedCommands: ['git push *'] },
    };
    repository.createBundle({
      id: 'policy_1',
      organisationId: 'org_1',
      name: 'safe-shell',
      version: 1,
      bundleDigest: sha256Canonical(bundle),
      bundle,
      status: 'active',
      createdBy: 'actor_1',
      createdAt: at,
    });
    repository.assign({
      id: 'assignment_1',
      policyBundleId: 'policy_1',
      projectId: 'project_1',
      roleId: 'executor',
      priority: 10,
      createdAt: at,
    });
    expect(
      repository.resolve({
        organisationId: 'org_1',
        projectId: 'project_1',
        roleId: 'executor',
      }),
    ).toMatchObject([{ id: 'policy_1', bundleDigest: sha256Canonical(bundle) }]);
    repository.createCredentialGrant({
      id: 'grant_1',
      organisationId: 'org_1',
      granteeActorId: 'actor_1',
      secretReference: 'keychain.github.app',
      capabilities: ['github.checks.write'],
      projectIds: ['project_1'],
      status: 'active',
      grantedBy: 'actor_1',
      grantedAt: at,
      expiresAt: '2026-07-29T12:00:00.000Z',
    });
    expect(
      repository.credentialDecision({
        grantId: 'grant_1',
        capability: 'github.checks.write',
        projectId: 'project_1',
        at,
      }),
    ).toMatchObject({ allowed: true, secretReference: 'keychain.github.app' });
    expect(
      repository.credentialDecision({
        grantId: 'grant_1',
        capability: 'github.admin',
        projectId: 'project_1',
        at,
      }),
    ).toMatchObject({ allowed: false });
    expect(() =>
      repository.createCredentialGrant({
        id: 'grant_secret',
        organisationId: 'org_1',
        granteeActorId: 'actor_1',
        secretReference: 'ghp_plaintext_secret',
        capabilities: [],
        projectIds: [],
        status: 'active',
        grantedBy: 'actor_1',
        grantedAt: at,
      }),
    ).toThrow(/never a secret value/);
  });
});

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
}
