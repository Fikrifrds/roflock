import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sealExecutionPlan, type UnhashedExecutionPlan } from '@roleflock/change-contracts';
import {
  ConcurrencyPolicyRepository,
  ExecutionPlanRepository,
  LeaseRepository,
  ProjectRepository,
  TaskRepository,
  WorktreeRepository,
  openMigratedDatabase,
} from '@roleflock/database';
import { WriterLease, createWorktree, registerRepository } from '@roleflock/repository-runtime';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';

const directories: string[] = [];
const servers: Array<Awaited<ReturnType<typeof createServer>>> = [];

afterEach(async () => {
  while (servers.length > 0) await servers.pop()!.app.close();
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
  WriterLease.clearAll();
});

describe('parallel crash recovery', () => {
  it('recovers four isolated tasks without losing slots, worktrees, or approved plan pins', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'roleflock-parallel-recovery-data-'));
    const repositoryDir = mkdtempSync(join(tmpdir(), 'roleflock-parallel-recovery-repo-'));
    directories.push(dataDir, repositoryDir);
    execFileSync('git', ['init'], { cwd: repositoryDir });
    execFileSync('git', ['config', 'user.email', 'test@roleflock.local'], {
      cwd: repositoryDir,
    });
    execFileSync('git', ['config', 'user.name', 'RoleFlock Test'], {
      cwd: repositoryDir,
    });
    writeFileSync(join(repositoryDir, 'README.md'), '# Parallel recovery fixture\n');
    execFileSync('git', ['add', 'README.md'], { cwd: repositoryDir });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repositoryDir });
    const primaryBranch = git(repositoryDir, ['branch', '--show-current']);
    const primaryStatus = git(repositoryDir, ['status', '--porcelain']);
    const baseCommit = git(repositoryDir, ['rev-parse', 'HEAD']);

    const first = await createServer({
      dataDir,
      session: { token: 'test-token', csrf: 'test-csrf' },
    });
    await first.app.close();
    const db = openMigratedDatabase(join(dataDir, 'roleflock.db'));
    const projectId = 'project_parallel';
    const timestamp = '2026-07-28T10:00:00.000Z';
    new ProjectRepository(db).create({
      id: projectId,
      workspaceId: 'local',
      name: 'Parallel fixture',
      repositoryPath: repositoryDir,
      resolvedPath: repositoryDir,
      baseBranch: primaryBranch,
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    const policies = new ConcurrencyPolicyRepository(db);
    policies.set('project', projectId, 4, 1, timestamp);
    const tasks = new TaskRepository(db);
    const plans = new ExecutionPlanRepository(db);
    const worktrees = new WorktreeRepository(db);
    const leases = new LeaseRepository(db);
    const repository = await registerRepository(repositoryDir);
    const planPins = new Map<string, string>();
    const worktreePaths: string[] = [];

    for (let index = 1; index <= 4; index += 1) {
      const taskId = `task_${index}`;
      tasks.upsert({
        id: taskId,
        projectId,
        type: 'bug_fix',
        title: `Parallel task ${index}`,
        brief: `Modify fixture ${index}.`,
        risk: 'medium',
        state: 'running',
        workflowGraphVersionId: 'bug_fix@3',
        budgetPolicyId: 'local-default',
        contractRequirement: 'required',
        maxAttempts: 3,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      expect(policies.tryAcquire(taskId, projectId, timestamp)).toMatchObject({
        admitted: true,
      });
      const worktree = await createWorktree(repository, taskId, {
        worktreeBaseDir: join(dataDir, 'worktrees'),
      });
      worktreePaths.push(worktree.path);
      const leaseId = `lease_${index}`;
      const nodeRunId = `node_${index}`;
      worktrees.create({
        id: `worktree_${index}`,
        taskId,
        projectId,
        path: worktree.path,
        branchName: worktree.branchName,
        baseCommit: worktree.baseCommit,
        writerLeaseId: leaseId,
        status: 'active',
        createdAt: timestamp,
      });
      leases.tryAcquire({
        id: leaseId,
        resourceType: 'writer',
        resourceId: worktree.path,
        ownerId: nodeRunId,
        acquiredAt: timestamp,
      });
      expect(new WriterLease(worktree.path, nodeRunId).acquire()).toBe(true);
      const proposed = sealExecutionPlan(planInput(taskId, index));
      plans.create(proposed);
      const approved = plans.approve(
        proposed.id,
        1,
        { actorId: 'authority', actorType: 'human' },
        timestamp,
      ).plan;
      planPins.set(taskId, approved.hash);
      db.prepare(
        `INSERT INTO graph_runs
          (id, task_id, graph_version_id, state, started_at, created_at)
         VALUES (?, ?, 'bug_fix@3', 'running', ?, ?)`,
      ).run(`run_${index}`, taskId, timestamp, timestamp);
      db.prepare(
        `INSERT INTO node_runs
          (id, graph_run_id, node_key, state, attempt, started_at, created_at)
         VALUES (?, ?, 'writer', 'running', 1, ?, ?)`,
      ).run(nodeRunId, `run_${index}`, timestamp, timestamp);
      db.prepare(
        `INSERT INTO invocations
          (id, node_run_id, provider_connection_id, configured_model_id, status, started_at)
         VALUES (?, ?, 'codex', 'model', 'running', ?)`,
      ).run(`invocation_${index}`, nodeRunId, timestamp);
    }
    db.close();

    const restarted = await createServer({
      dataDir,
      session: { token: 'test-token', csrf: 'test-csrf' },
    });
    servers.push(restarted);
    const recoveredDb = openMigratedDatabase(join(dataDir, 'roleflock.db'));
    const recoveredPolicies = new ConcurrencyPolicyRepository(recoveredDb);
    const recoveredPlans = new ExecutionPlanRepository(recoveredDb);
    const recoveredWorktrees = new WorktreeRepository(recoveredDb);
    const recoveredLeases = new LeaseRepository(recoveredDb);

    expect(recoveredPolicies.activeTaskIds()).toEqual(['task_1', 'task_2', 'task_3', 'task_4']);
    expect(
      recoveredDb.prepare(`SELECT DISTINCT state FROM graph_runs ORDER BY state`).all(),
    ).toEqual([{ state: 'interrupted' }]);
    expect(
      recoveredDb.prepare(`SELECT DISTINCT state FROM node_runs ORDER BY state`).all(),
    ).toEqual([{ state: 'interrupted' }]);
    expect(
      recoveredDb.prepare(`SELECT DISTINCT status FROM invocations ORDER BY status`).all(),
    ).toEqual([{ status: 'interrupted' }]);

    for (let index = 1; index <= 4; index += 1) {
      const taskId = `task_${index}`;
      const worktree = recoveredWorktrees.getByTask(taskId)!;
      expect(worktree.writerLeaseId).toBeUndefined();
      expect(existsSync(worktree.path)).toBe(true);
      expect(recoveredPlans.getByTask(taskId)?.plan).toMatchObject({
        status: 'approved',
        hash: planPins.get(taskId),
      });
      expect(recoveredLeases.getActive('writer', worktree.path)).toBeUndefined();
      expect(WriterLease.holder(worktree.path)).toBeUndefined();
      expect(recoveredPolicies.tryAcquire(taskId, projectId, timestamp)).toMatchObject({
        admitted: true,
        reused: true,
      });
      recoveredLeases.tryAcquire({
        id: `recovered_lease_${index}`,
        resourceType: 'writer',
        resourceId: worktree.path,
        ownerId: `recovered_node_${index}`,
        acquiredAt: timestamp,
      });
    }
    expect(worktreePaths.map((path) => recoveredLeases.getActive('writer', path)?.ownerId)).toEqual(
      ['recovered_node_1', 'recovered_node_2', 'recovered_node_3', 'recovered_node_4'],
    );
    expect(git(repositoryDir, ['branch', '--show-current'])).toBe(primaryBranch);
    expect(git(repositoryDir, ['status', '--porcelain'])).toBe(primaryStatus);
    expect(git(repositoryDir, ['rev-parse', 'HEAD'])).toBe(baseCommit);
    recoveredDb.close();
  });
});

function planInput(taskId: string, index: number): UnhashedExecutionPlan {
  const path = `src/fixture-${index}.ts`;
  return {
    id: `plan_${taskId}`,
    taskId,
    contractId: `contract_${taskId}`,
    contractHash: 'a'.repeat(64),
    version: 1,
    status: 'proposed',
    summary: `Implement isolated fixture ${index}.`,
    assumptions: [],
    steps: [
      {
        id: 'STEP-1',
        objective: `Modify fixture ${index}.`,
        criterionIds: ['AC-1'],
        allowedOperations: ['modify_file'],
        expectedFiles: [path],
        completionEvidenceIds: ['E-1'],
      },
    ],
    allowedPaths: ['src'],
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
      pathScope: ['src'],
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

function git(directory: string, args: string[]): string {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
}
