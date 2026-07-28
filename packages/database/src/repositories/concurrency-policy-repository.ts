import type { SqliteDb } from '../client.js';

export type ConcurrencyScope = 'global' | 'project';

export type ConcurrencyPolicy = {
  scopeType: ConcurrencyScope;
  scopeId: string;
  maxActiveTasks: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ConcurrencyAdmission =
  | {
      admitted: true;
      reused: boolean;
      globalActive: number;
      projectActive: number;
      globalLimit: number;
      projectLimit: number;
    }
  | {
      admitted: false;
      limitingScope: ConcurrencyScope;
      active: number;
      limit: number;
      globalActive: number;
      projectActive: number;
      globalLimit: number;
      projectLimit: number;
    };

const DEFAULT_PROJECT_LIMIT = 2;

export class ConcurrencyPolicyRepository {
  constructor(private readonly db: SqliteDb) {}

  getGlobal(): ConcurrencyPolicy {
    const policy = this.get('global', '*');
    if (policy === undefined) throw new Error('Global concurrency policy is missing');
    return policy;
  }

  getProject(projectId: string): ConcurrencyPolicy {
    return this.ensureProject(projectId);
  }

  set(
    scopeType: ConcurrencyScope,
    scopeId: string,
    maxActiveTasks: number,
    expectedRevision?: number,
    updatedAt = new Date().toISOString(),
  ): ConcurrencyPolicy {
    if (!Number.isInteger(maxActiveTasks) || maxActiveTasks < 1 || maxActiveTasks > 128) {
      throw new Error('maxActiveTasks must be an integer between 1 and 128');
    }
    if (scopeType === 'global' && scopeId !== '*') {
      throw new Error('The global concurrency scope ID must be *');
    }
    const existing =
      scopeType === 'project'
        ? this.ensureProject(scopeId, updatedAt)
        : this.get(scopeType, scopeId);
    if (existing === undefined) throw new Error('Concurrency policy not found');
    if (expectedRevision !== undefined && existing.revision !== expectedRevision) {
      throw new Error(
        `Concurrency policy revision conflict: expected ${expectedRevision}, actual ${existing.revision}`,
      );
    }
    this.db
      .prepare(
        `UPDATE concurrency_policies
         SET max_active_tasks = ?, revision = revision + 1, updated_at = ?
         WHERE scope_type = ? AND scope_id = ? AND revision = ?`,
      )
      .run(maxActiveTasks, updatedAt, scopeType, scopeId, existing.revision);
    return this.get(scopeType, scopeId)!;
  }

  tryAcquire(taskId: string, projectId: string, acquiredAt: string): ConcurrencyAdmission {
    return this.db.transaction(() => {
      const global = this.getGlobal();
      const project = this.ensureProject(projectId, acquiredAt);
      const existing = this.db
        .prepare(`SELECT released_at FROM concurrency_slots WHERE task_id = ?`)
        .get(taskId) as { released_at: string | null } | undefined;
      const globalActive = this.activeCount();
      const projectActive = this.activeCount(projectId);
      if (existing?.released_at === null) {
        return admitted(true, globalActive, projectActive, global, project);
      }
      if (globalActive >= global.maxActiveTasks) {
        return rejected('global', globalActive, projectActive, global, project);
      }
      if (projectActive >= project.maxActiveTasks) {
        return rejected('project', globalActive, projectActive, global, project);
      }
      this.db
        .prepare(
          `INSERT INTO concurrency_slots (task_id, project_id, acquired_at, released_at)
           VALUES (?, ?, ?, NULL)
           ON CONFLICT(task_id) DO UPDATE SET
             project_id = excluded.project_id,
             acquired_at = excluded.acquired_at,
             released_at = NULL`,
        )
        .run(taskId, projectId, acquiredAt);
      return admitted(false, globalActive + 1, projectActive + 1, global, project);
    })();
  }

  release(taskId: string, releasedAt: string): boolean {
    const result = this.db
      .prepare(
        `UPDATE concurrency_slots SET released_at = ?
         WHERE task_id = ? AND released_at IS NULL`,
      )
      .run(releasedAt, taskId);
    return result.changes === 1;
  }

  activeTaskIds(projectId?: string): string[] {
    const rows =
      projectId === undefined
        ? (this.db
            .prepare(
              `SELECT task_id FROM concurrency_slots
               WHERE released_at IS NULL ORDER BY acquired_at, task_id`,
            )
            .all() as Array<{ task_id: string }>)
        : (this.db
            .prepare(
              `SELECT task_id FROM concurrency_slots
               WHERE released_at IS NULL AND project_id = ? ORDER BY acquired_at, task_id`,
            )
            .all(projectId) as Array<{ task_id: string }>);
    return rows.map((row) => row.task_id);
  }

  private get(scopeType: ConcurrencyScope, scopeId: string): ConcurrencyPolicy | undefined {
    const row = this.db
      .prepare(`SELECT * FROM concurrency_policies WHERE scope_type = ? AND scope_id = ?`)
      .get(scopeType, scopeId) as Record<string, unknown> | undefined;
    return row === undefined ? undefined : mapPolicy(row);
  }

  private ensureProject(
    projectId: string,
    createdAt = new Date().toISOString(),
  ): ConcurrencyPolicy {
    if (!projectId.trim()) throw new Error('projectId is required');
    const existing = this.get('project', projectId);
    if (existing !== undefined) return existing;
    const global = this.getGlobal();
    this.db
      .prepare(
        `INSERT OR IGNORE INTO concurrency_policies (
           scope_type, scope_id, max_active_tasks, revision, created_at, updated_at
         ) VALUES ('project', ?, ?, 1, ?, ?)`,
      )
      .run(projectId, Math.min(DEFAULT_PROJECT_LIMIT, global.maxActiveTasks), createdAt, createdAt);
    return this.get('project', projectId)!;
  }

  private activeCount(projectId?: string): number {
    const row =
      projectId === undefined
        ? (this.db
            .prepare(`SELECT COUNT(*) AS count FROM concurrency_slots WHERE released_at IS NULL`)
            .get() as { count: number })
        : (this.db
            .prepare(
              `SELECT COUNT(*) AS count FROM concurrency_slots
               WHERE released_at IS NULL AND project_id = ?`,
            )
            .get(projectId) as { count: number });
    return Number(row.count);
  }
}

function admitted(
  reused: boolean,
  globalActive: number,
  projectActive: number,
  global: ConcurrencyPolicy,
  project: ConcurrencyPolicy,
): ConcurrencyAdmission {
  return {
    admitted: true,
    reused,
    globalActive,
    projectActive,
    globalLimit: global.maxActiveTasks,
    projectLimit: project.maxActiveTasks,
  };
}

function rejected(
  limitingScope: ConcurrencyScope,
  globalActive: number,
  projectActive: number,
  global: ConcurrencyPolicy,
  project: ConcurrencyPolicy,
): ConcurrencyAdmission {
  return {
    admitted: false,
    limitingScope,
    active: limitingScope === 'global' ? globalActive : projectActive,
    limit: limitingScope === 'global' ? global.maxActiveTasks : project.maxActiveTasks,
    globalActive,
    projectActive,
    globalLimit: global.maxActiveTasks,
    projectLimit: project.maxActiveTasks,
  };
}

function mapPolicy(row: Record<string, unknown>): ConcurrencyPolicy {
  return {
    scopeType: String(row.scope_type) as ConcurrencyScope,
    scopeId: String(row.scope_id),
    maxActiveTasks: Number(row.max_active_tasks),
    revision: Number(row.revision),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}
