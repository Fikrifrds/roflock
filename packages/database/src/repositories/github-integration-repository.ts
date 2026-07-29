import type { SqliteDb } from '../client.js';

export interface GitHubInstallation {
  id: string;
  githubInstallationId: string;
  accountId: string;
  accountLogin: string;
  accountType: 'User' | 'Organization';
  status: 'active' | 'suspended' | 'removed';
  createdAt: string;
  updatedAt: string;
}

export interface GitHubRepositoryMapping {
  id: string;
  installationId: string;
  githubRepositoryId: string;
  nodeId?: string;
  ownerLogin: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  projectId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GitHubActorMapping {
  id: string;
  githubUserId: string;
  nodeId?: string;
  login: string;
  roleflockActorId: string;
  createdAt: string;
  updatedAt: string;
}

export class GitHubIntegrationRepository {
  constructor(private readonly db: SqliteDb) {}

  upsertInstallation(value: GitHubInstallation): GitHubInstallation {
    this.db
      .prepare(
        `INSERT INTO github_installations (
           id, github_installation_id, account_id, account_login, account_type,
           status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(github_installation_id) DO UPDATE SET
           account_id = excluded.account_id,
           account_login = excluded.account_login,
           account_type = excluded.account_type,
           status = excluded.status,
           updated_at = excluded.updated_at`,
      )
      .run(
        value.id,
        value.githubInstallationId,
        value.accountId,
        value.accountLogin,
        value.accountType,
        value.status,
        value.createdAt,
        value.updatedAt,
      );
    return this.getInstallationByGitHubId(value.githubInstallationId)!;
  }

  getInstallationByGitHubId(githubInstallationId: string): GitHubInstallation | undefined {
    const row = this.db
      .prepare(`SELECT * FROM github_installations WHERE github_installation_id = ?`)
      .get(githubInstallationId) as Record<string, unknown> | undefined;
    return row ? mapInstallation(row) : undefined;
  }

  upsertRepository(value: GitHubRepositoryMapping): GitHubRepositoryMapping {
    if (!this.getInstallation(value.installationId)) {
      throw new Error(`GitHub installation not found: ${value.installationId}`);
    }
    this.db
      .prepare(
        `INSERT INTO github_repositories (
           id, installation_id, github_repository_id, node_id, owner_login, name,
           full_name, default_branch, project_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(github_repository_id) DO UPDATE SET
           installation_id = excluded.installation_id,
           node_id = excluded.node_id,
           owner_login = excluded.owner_login,
           name = excluded.name,
           full_name = excluded.full_name,
           default_branch = excluded.default_branch,
           project_id = excluded.project_id,
           updated_at = excluded.updated_at`,
      )
      .run(
        value.id,
        value.installationId,
        value.githubRepositoryId,
        value.nodeId ?? null,
        value.ownerLogin,
        value.name,
        value.fullName,
        value.defaultBranch,
        value.projectId ?? null,
        value.createdAt,
        value.updatedAt,
      );
    return this.getRepositoryByGitHubId(value.githubRepositoryId)!;
  }

  getRepositoryByProject(projectId: string): GitHubRepositoryMapping | undefined {
    const row = this.db
      .prepare(`SELECT * FROM github_repositories WHERE project_id = ?`)
      .get(projectId) as Record<string, unknown> | undefined;
    return row ? mapRepository(row) : undefined;
  }

  getRepositoryByGitHubId(githubRepositoryId: string): GitHubRepositoryMapping | undefined {
    const row = this.db
      .prepare(`SELECT * FROM github_repositories WHERE github_repository_id = ?`)
      .get(githubRepositoryId) as Record<string, unknown> | undefined;
    return row ? mapRepository(row) : undefined;
  }

  upsertActor(value: GitHubActorMapping): GitHubActorMapping {
    this.db
      .prepare(
        `INSERT INTO github_actors (
           id, github_user_id, node_id, login, roleflock_actor_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(github_user_id) DO UPDATE SET
           node_id = excluded.node_id,
           login = excluded.login,
           roleflock_actor_id = excluded.roleflock_actor_id,
           updated_at = excluded.updated_at`,
      )
      .run(
        value.id,
        value.githubUserId,
        value.nodeId ?? null,
        value.login,
        value.roleflockActorId,
        value.createdAt,
        value.updatedAt,
      );
    return this.getActorByGitHubId(value.githubUserId)!;
  }

  getActorByGitHubId(githubUserId: string): GitHubActorMapping | undefined {
    const row = this.db
      .prepare(`SELECT * FROM github_actors WHERE github_user_id = ?`)
      .get(githubUserId) as Record<string, unknown> | undefined;
    return row ? mapActor(row) : undefined;
  }

  private getInstallation(id: string): GitHubInstallation | undefined {
    const row = this.db.prepare(`SELECT * FROM github_installations WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapInstallation(row) : undefined;
  }
}

function mapInstallation(row: Record<string, unknown>): GitHubInstallation {
  return {
    id: String(row.id),
    githubInstallationId: String(row.github_installation_id),
    accountId: String(row.account_id),
    accountLogin: String(row.account_login),
    accountType: row.account_type as GitHubInstallation['accountType'],
    status: row.status as GitHubInstallation['status'],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapRepository(row: Record<string, unknown>): GitHubRepositoryMapping {
  return {
    id: String(row.id),
    installationId: String(row.installation_id),
    githubRepositoryId: String(row.github_repository_id),
    nodeId: row.node_id ? String(row.node_id) : undefined,
    ownerLogin: String(row.owner_login),
    name: String(row.name),
    fullName: String(row.full_name),
    defaultBranch: String(row.default_branch),
    projectId: row.project_id ? String(row.project_id) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapActor(row: Record<string, unknown>): GitHubActorMapping {
  return {
    id: String(row.id),
    githubUserId: String(row.github_user_id),
    nodeId: row.node_id ? String(row.node_id) : undefined,
    login: String(row.login),
    roleflockActorId: String(row.roleflock_actor_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
