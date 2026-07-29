import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, migrate, type SqliteDb } from './client.js';
import { GitHubIntegrationRepository } from './repositories/github-integration-repository.js';

let db: SqliteDb | undefined;
afterEach(() => db?.close());

describe('GitHub identity and repository mapping', () => {
  it('durably maps installation, repository, project, and actor identities', () => {
    db = openDatabase({ path: ':memory:' });
    migrate(db);
    seedProject(db);
    const repository = new GitHubIntegrationRepository(db);
    const at = '2026-07-28T12:00:00.000Z';
    repository.upsertInstallation({
      id: 'github_installation_1',
      githubInstallationId: '1001',
      accountId: '2001',
      accountLogin: 'roleflock',
      accountType: 'Organization',
      status: 'active',
      createdAt: at,
      updatedAt: at,
    });
    repository.upsertRepository({
      id: 'github_repository_1',
      installationId: 'github_installation_1',
      githubRepositoryId: '3001',
      nodeId: 'R_repo',
      ownerLogin: 'roleflock',
      name: 'core',
      fullName: 'roleflock/core',
      defaultBranch: 'main',
      projectId: 'project_1',
      createdAt: at,
      updatedAt: at,
    });
    repository.upsertActor({
      id: 'github_actor_1',
      githubUserId: '4001',
      nodeId: 'U_actor',
      login: 'octocat',
      roleflockActorId: 'actor_local_1',
      createdAt: at,
      updatedAt: at,
    });
    expect(repository.getRepositoryByProject('project_1')).toMatchObject({
      githubRepositoryId: '3001',
      fullName: 'roleflock/core',
    });
    expect(repository.getActorByGitHubId('4001')).toMatchObject({
      login: 'octocat',
      roleflockActorId: 'actor_local_1',
    });
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
