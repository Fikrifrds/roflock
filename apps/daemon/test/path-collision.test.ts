import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sealExecutionPlan, type UnhashedExecutionPlan } from '@roleflock/change-contracts';
import {
  ExecutionPlanRepository,
  TaskRepository,
  WorktreeRepository,
  openMigratedDatabase,
} from '@roleflock/database';
import { afterEach, describe, expect, it } from 'vitest';
import { findTaskPathCollisions } from '../src/services/path-collision.js';

const directories: string[] = [];
afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function plan(taskId: string, path: string): UnhashedExecutionPlan {
  return {
    id: `plan_${taskId}`,
    taskId,
    contractId: `contract_${taskId}`,
    contractHash: 'a'.repeat(64),
    version: 1,
    status: 'proposed',
    summary: `Plan for ${taskId}.`,
    assumptions: [],
    steps: [
      {
        id: 'STEP-1',
        objective: 'Modify the expected file.',
        criterionIds: ['AC-1'],
        allowedOperations: ['modify_file'],
        expectedFiles: [path],
        completionEvidenceIds: ['E-1'],
      },
    ],
    allowedPaths: [path],
    expectedChangedPaths: [path],
    forbiddenPaths: [],
    dependencyChanges: [],
    migrationActions: [],
    verificationSpecId: `verification_${taskId}`,
    repairEnvelope: {
      allowedFailureClasses: [],
      maxAttempts: 0,
      mayAddFiles: false,
      mayChangeDependencies: false,
      mayChangePublicApi: false,
      mayChangeSchema: false,
      pathScope: [path],
    },
    changeBudget: {
      maxChangedFiles: 1,
      maxAddedLines: 50,
      maxDeletedLines: 50,
      maxNewDependencies: 0,
    },
    decisionLog: [],
    proposedBy: {
      invocationId: `planner_${taskId}`,
      role: 'planner',
      providerId: 'provider',
      modelId: 'model',
    },
  };
}

describe('task path collision service', () => {
  it('compares a candidate only with active tasks in the same project', () => {
    const directory = mkdtempSync(join(tmpdir(), 'roleflock-collision-'));
    directories.push(directory);
    const db = openMigratedDatabase(join(directory, 'test.db'));
    const tasks = new TaskRepository(db);
    const plans = new ExecutionPlanRepository(db);
    const worktrees = new WorktreeRepository(db);
    for (const [id, projectId] of [
      ['candidate', 'project-a'],
      ['active', 'project-a'],
      ['inactive', 'project-a'],
      ['other-project', 'project-b'],
    ] as const) {
      tasks.upsert({
        id,
        projectId,
        type: 'bug_fix',
        title: id,
        brief: id,
        risk: 'medium',
        state: 'ready',
        workflowGraphVersionId: 'bug_fix@3',
        budgetPolicyId: 'local-default',
        contractRequirement: 'required',
        maxAttempts: 3,
        createdAt: '2026-07-28T10:00:00.000Z',
        updatedAt: '2026-07-28T10:00:00.000Z',
      });
      plans.create(sealExecutionPlan(plan(id, 'src/cart.ts')));
    }
    worktrees.create({
      id: 'worktree-active',
      taskId: 'active',
      projectId: 'project-a',
      path: '/tmp/active',
      branchName: 'roleflock/active',
      baseCommit: 'a'.repeat(40),
      status: 'active',
      createdAt: '2026-07-28T10:00:00.000Z',
    });
    worktrees.create({
      id: 'worktree-other',
      taskId: 'other-project',
      projectId: 'project-b',
      path: '/tmp/other',
      branchName: 'roleflock/other',
      baseCommit: 'a'.repeat(40),
      status: 'active',
      createdAt: '2026-07-28T10:00:00.000Z',
    });

    expect(findTaskPathCollisions(db, 'candidate')).toEqual([
      expect.objectContaining({
        taskId: 'active',
        planId: 'plan_active',
        path: 'src/cart.ts',
        conflictingPath: 'src/cart.ts',
        kind: 'exact',
      }),
    ]);
  });
});
