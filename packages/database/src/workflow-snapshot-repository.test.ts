import { describe, expect, it } from 'vitest';
import { migrate, openDatabase } from './client.js';
import { TaskRepository } from './repositories/task-repository.js';
import { WorkflowSnapshotRepository } from './repositories/workflow-snapshot-repository.js';

function database() {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  return db;
}

describe('WorkflowSnapshotRepository', () => {
  it('keeps one immutable source, IR, and executable graph per task', () => {
    const db = database();
    const tasks = new TaskRepository(db);
    tasks.upsert({
      id: 'task_1',
      projectId: 'project_1',
      type: 'bug_fix',
      title: 'Pinned task',
      brief: 'Keep this graph exact',
      risk: 'medium',
      state: 'ready',
      workflowGraphVersionId: 'bug_fix@3',
      budgetPolicyId: 'local-default',
      maxAttempts: 3,
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    });

    const snapshots = new WorkflowSnapshotRepository(db);
    const record = {
      taskId: 'task_1',
      graphVersionId: 'bug_fix@3',
      semanticHash: 'sha256:semantic',
      graphSnapshotHash: 'sha256:graph',
      source: 'workflow bug_fix {}',
      graphIrJson: '{"workflow":{"id":"bug_fix"}}',
      workflowGraphJson: '{"id":"bug_fix"}',
      createdAt: '2026-08-09T00:00:00.000Z',
    };

    expect(snapshots.create(record)).toEqual(record);
    expect(snapshots.get('task_1')).toEqual(record);
    expect(snapshots.has('task_1')).toBe(true);
    expect(() => snapshots.create({ ...record, workflowGraphJson: '{"id":"changed"}' })).toThrow();

    db.close();
  });

  it('is removed with the task, while no independent update path exists', () => {
    const db = database();
    const tasks = new TaskRepository(db);
    tasks.upsert({
      id: 'task_1',
      projectId: 'project_1',
      type: 'bug_fix',
      title: 'Pinned task',
      brief: 'Delete me',
      risk: 'medium',
      state: 'ready',
      workflowGraphVersionId: 'bug_fix@3',
      budgetPolicyId: 'local-default',
      maxAttempts: 3,
      createdAt: '2026-08-09T00:00:00.000Z',
      updatedAt: '2026-08-09T00:00:00.000Z',
    });
    const snapshots = new WorkflowSnapshotRepository(db);
    snapshots.create({
      taskId: 'task_1',
      graphVersionId: 'bug_fix@3',
      graphSnapshotHash: 'sha256:graph',
      workflowGraphJson: '{"id":"bug_fix"}',
      createdAt: '2026-08-09T00:00:00.000Z',
    });

    expect(tasks.delete('task_1')).toBe(true);
    expect(snapshots.get('task_1')).toBeUndefined();
    db.close();
  });
});
