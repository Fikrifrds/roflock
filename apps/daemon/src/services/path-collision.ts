import { predictExpectedPathCollisions } from '@roleflock/change-contracts';
import {
  ExecutionPlanRepository,
  TaskRepository,
  WorktreeRepository,
  type SqliteDb,
} from '@roleflock/database';

export function findTaskPathCollisions(db: SqliteDb, taskId: string) {
  const tasks = new TaskRepository(db);
  const plans = new ExecutionPlanRepository(db);
  const worktrees = new WorktreeRepository(db);
  const task = tasks.get(taskId);
  const candidate = plans.getByTask(taskId)?.plan;
  if (task === undefined || candidate === undefined || candidate.status === 'cancelled') {
    return [];
  }
  const activePlans = worktrees
    .listActiveByProject(task.projectId)
    .filter((worktree) => worktree.taskId !== taskId)
    .flatMap((worktree) => {
      const plan = plans.getByTask(worktree.taskId)?.plan;
      return plan !== undefined && plan.status !== 'cancelled' && plan.status !== 'superseded'
        ? [plan]
        : [];
    });
  return predictExpectedPathCollisions(candidate, activePlans);
}
