import { afterEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type SqliteDb } from './client.js';
import { OrganisationRepository } from './repositories/organisation-repository.js';

let db: SqliteDb | undefined;
afterEach(() => db?.close());

describe('organisation RBAC', () => {
  it('authorises durable active memberships within project scope and fails closed', () => {
    db = openDatabase({ path: ':memory:' });
    migrate(db);
    seedProject(db);
    const repository = new OrganisationRepository(db);
    const at = '2026-07-28T12:00:00.000Z';
    repository.createOrganisation({
      id: 'org_1',
      slug: 'roleflock',
      name: 'RoleFlock',
      status: 'active',
      createdAt: at,
      updatedAt: at,
    });
    repository.createActor({
      id: 'actor_1',
      actorType: 'human',
      displayName: 'Planner',
      status: 'active',
      createdAt: at,
      updatedAt: at,
    });
    repository.upsertMembership({
      id: 'membership_1',
      organisationId: 'org_1',
      actorId: 'actor_1',
      role: 'planner',
      status: 'active',
      createdAt: at,
      updatedAt: at,
    });
    repository.attachProject('org_1', 'project_1', at);
    expect(
      repository.authorise({
        organisationId: 'org_1',
        actorId: 'actor_1',
        action: 'plan_manage',
        projectId: 'project_1',
      }),
    ).toMatchObject({ allowed: true, role: 'planner' });
    expect(
      repository.authorise({
        organisationId: 'org_1',
        actorId: 'actor_1',
        action: 'execute',
        projectId: 'project_1',
      }),
    ).toMatchObject({ allowed: false, role: 'planner' });
    expect(
      repository.authorise({
        organisationId: 'org_1',
        actorId: 'unknown',
        action: 'passport_read',
      }),
    ).toMatchObject({ allowed: false });
  });
});

function seedProject(database: SqliteDb): void {
  database
    .prepare(
      `INSERT INTO projects (
         id, workspace_id, name, repository_path, resolved_path, base_branch,
         status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'project_1',
      'workspace_1',
      'Core',
      '/repo',
      '/repo',
      'main',
      'active',
      '2026-07-28T12:00:00.000Z',
      '2026-07-28T12:00:00.000Z',
    );
}
