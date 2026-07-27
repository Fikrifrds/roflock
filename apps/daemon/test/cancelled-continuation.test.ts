import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMigratedDatabase, WorktreeRepository } from '@roleflock/database';
import { afterEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/server.js';

const cleanup: Array<() => Promise<void>> = [];
const session = { token: 'test-token', csrf: 'test-csrf' };
const headers = {
  'x-roleflock-token': session.token,
  'x-roleflock-csrf': session.csrf,
  'content-type': 'application/json',
};

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
});

describe('cancelled task continuation', () => {
  it('accepts Continue and reuses the preserved worktree', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'rf-continue-data-'));
    const repoDir = await mkdtemp(join(tmpdir(), 'rf-continue-repo-'));
    execFileSync('git', ['init'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.email', 'test@roleflock.local'], { cwd: repoDir });
    execFileSync('git', ['config', 'user.name', 'RoleFlock'], { cwd: repoDir });
    await writeFile(join(repoDir, 'README.md'), '# fixture\n');
    execFileSync('git', ['add', 'README.md'], { cwd: repoDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repoDir });

    const instance = await createServer({ dataDir, session });
    cleanup.push(async () => {
      await instance.app.close();
      await rm(dataDir, { recursive: true, force: true });
      await rm(repoDir, { recursive: true, force: true });
    });

    const project = (
      await instance.app.inject({
        method: 'POST',
        url: '/api/projects',
        headers,
        payload: { path: repoDir },
      })
    ).json() as { id: string };
    const task = (
      await instance.app.inject({
        method: 'POST',
        url: '/api/tasks',
        headers,
        payload: {
          projectId: project.id,
          type: 'bug_fix',
          title: 'Continue preserved work',
          brief: 'Resume this task without replacing its worktree.',
        },
      })
    ).json() as { id: string; workflowGraphVersionId: string };

    const worktreePath = join(dataDir, 'preserved-worktree');
    const branchName = `roleflock/test-${task.id}`;
    await mkdir(join(dataDir, 'worktrees'), { recursive: true });
    execFileSync('git', ['worktree', 'add', '-b', branchName, worktreePath, 'HEAD'], {
      cwd: repoDir,
    });
    const baseCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoDir,
      encoding: 'utf8',
    }).trim();

    const db = openMigratedDatabase(join(dataDir, 'roleflock.db'));
    const at = new Date().toISOString();
    db.prepare('UPDATE tasks SET state = ?, updated_at = ? WHERE id = ?').run(
      'cancelled',
      at,
      task.id,
    );
    db.prepare(
      `INSERT INTO graph_runs
        (id, task_id, graph_version_id, state, started_at, completed_at, created_at)
       VALUES (?, ?, ?, 'failed', ?, ?, ?)`,
    ).run('cancelled-run', task.id, task.workflowGraphVersionId, at, at, at);
    new WorktreeRepository(db).create({
      id: 'preserved-worktree',
      taskId: task.id,
      projectId: project.id,
      path: worktreePath,
      branchName,
      baseCommit,
      status: 'dirty_preserved',
      createdAt: at,
    });
    db.close();

    const response = await instance.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/start`,
      headers,
      payload: {},
    });
    expect(response.statusCode).toBe(202);

    const workspace = (
      await instance.app.inject({
        method: 'GET',
        url: `/api/tasks/${task.id}/workspace`,
        headers,
      })
    ).json() as { branchName: string; worktreeStatus: string };
    expect(workspace.branchName).toBe(branchName);
    expect(workspace.worktreeStatus).toBe('active');

    await instance.app.inject({
      method: 'POST',
      url: `/api/tasks/${task.id}/cancel`,
      headers,
      payload: {},
    });
  });
});
