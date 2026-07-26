import type { SqliteDb } from '../client.js';

export interface ProjectRecord {
  id: string;
  workspaceId: string;
  name: string;
  repositoryPath: string;
  resolvedPath: string;
  baseBranch: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export class ProjectRepository {
  constructor(private readonly db: SqliteDb) {}

  create(project: ProjectRecord): ProjectRecord {
    this.db
      .prepare(
        `INSERT INTO projects
          (id, workspace_id, name, repository_path, resolved_path, base_branch, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.workspaceId,
        project.name,
        project.repositoryPath,
        project.resolvedPath,
        project.baseBranch,
        project.status,
        project.createdAt,
        project.updatedAt,
      );
    return project;
  }

  list(): ProjectRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, workspace_id, name, repository_path, resolved_path, base_branch, status, created_at, updated_at
         FROM projects ORDER BY created_at DESC`,
      )
      .all() as Array<Record<string, string>>;
    return rows.map(mapProject);
  }

  get(id: string): ProjectRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, workspace_id, name, repository_path, resolved_path, base_branch, status, created_at, updated_at
         FROM projects WHERE id = ?`,
      )
      .get(id) as Record<string, string> | undefined;
    return row ? mapProject(row) : undefined;
  }
}

function mapProject(row: Record<string, string>): ProjectRecord {
  return {
    id: row.id!,
    workspaceId: row.workspace_id!,
    name: row.name!,
    repositoryPath: row.repository_path!,
    resolvedPath: row.resolved_path!,
    baseBranch: row.base_branch!,
    status: row.status!,
    createdAt: row.created_at!,
    updatedAt: row.updated_at!,
  };
}
