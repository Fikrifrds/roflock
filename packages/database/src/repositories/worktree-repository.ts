import type { SqliteDb } from '../client.js';

export interface WorktreeRecord {
  id: string;
  taskId: string;
  projectId: string;
  path: string;
  branchName: string;
  baseCommit: string;
  writerLeaseId?: string;
  status: 'active' | 'dirty_preserved' | 'archived' | 'deleted';
  createdAt: string;
  archivedAt?: string;
}

export class WorktreeRepository {
  constructor(private readonly db: SqliteDb) {}

  create(record: WorktreeRecord): WorktreeRecord {
    this.db
      .prepare(
        `INSERT INTO worktrees
          (id, task_id, project_id, path, branch_name, base_commit, writer_lease_id, status, created_at, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.taskId,
        record.projectId,
        record.path,
        record.branchName,
        record.baseCommit,
        record.writerLeaseId ?? null,
        record.status,
        record.createdAt,
        record.archivedAt ?? null,
      );
    return record;
  }

  getByTask(taskId: string): WorktreeRecord | undefined {
    const row = this.db
      .prepare(`SELECT * FROM worktrees WHERE task_id = ?`)
      .get(taskId) as Record<string, unknown> | undefined;
    return row ? mapWorktree(row) : undefined;
  }

  setWriterLease(taskId: string, leaseId: string | null): void {
    this.db
      .prepare(`UPDATE worktrees SET writer_lease_id = ? WHERE task_id = ?`)
      .run(leaseId, taskId);
  }

  setStatus(taskId: string, status: WorktreeRecord['status'], archivedAt?: string): void {
    this.db
      .prepare(`UPDATE worktrees SET status = ?, archived_at = COALESCE(?, archived_at) WHERE task_id = ?`)
      .run(status, archivedAt ?? null, taskId);
  }
}

function mapWorktree(row: Record<string, unknown>): WorktreeRecord {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    projectId: String(row.project_id),
    path: String(row.path),
    branchName: String(row.branch_name),
    baseCommit: String(row.base_commit),
    writerLeaseId: row.writer_lease_id ? String(row.writer_lease_id) : undefined,
    status: row.status as WorktreeRecord['status'],
    createdAt: String(row.created_at),
    archivedAt: row.archived_at ? String(row.archived_at) : undefined,
  };
}
