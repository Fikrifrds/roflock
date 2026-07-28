import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  commitTaskWorkspace,
  inspectTaskFileDiff,
  inspectTaskWorkspace,
  pushTaskWorkspace,
  stageTaskFiles,
  unstageTaskFiles,
} from '../src/services/task-workspace.js';

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'roleflock-workspace-'));
  git(root, 'init');
  git(root, 'config', 'user.email', 'roleflock@test.local');
  git(root, 'config', 'user.name', 'RoleFlock Test');
  writeFileSync(join(root, 'README.md'), '# RoleFlock\n');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-m', 'initial');
  git(root, 'branch', '-M', 'roleflock/task-1');
  return {
    root,
    worktree: {
      path: root,
      branchName: 'roleflock/task-1',
      baseCommit: git(root, 'rev-parse', 'HEAD'),
      status: 'active' as const,
    },
  };
}

describe('task workspace Git service', () => {
  it('inspects, stages, unstages, and commits only the selected worktree', async () => {
    const { root, worktree } = fixture();
    writeFileSync(join(root, 'README.md'), '# RoleFlock\n\nGoverned changes.\n');

    let summary = await inspectTaskWorkspace(worktree);
    expect(summary.branchName).toBe('roleflock/task-1');
    expect(summary.path).toBe(root);
    expect(summary.files).toEqual([
      expect.objectContaining({ path: 'README.md', worktreeStatus: 'M', added: 2 }),
    ]);

    await stageTaskFiles(worktree, ['README.md']);
    summary = await inspectTaskWorkspace(worktree);
    expect(summary.files[0]?.indexStatus).toBe('M');

    await unstageTaskFiles(worktree, ['README.md']);
    expect((await inspectTaskWorkspace(worktree)).files[0]?.worktreeStatus).toBe('M');

    await stageTaskFiles(worktree, []);
    const committed = await commitTaskWorkspace(worktree, 'Verify governed workspace');
    expect(committed.commit).toBe(git(root, 'rev-parse', 'HEAD'));
    expect((await inspectTaskWorkspace(worktree)).files).toHaveLength(0);
  });

  it('pushes only the explicit task branch to origin', async () => {
    const { root, worktree } = fixture();
    const remote = mkdtempSync(join(tmpdir(), 'roleflock-remote-'));
    execFileSync('git', ['init', '--bare', remote]);
    git(root, 'remote', 'add', 'origin', remote);

    const result = await pushTaskWorkspace(worktree);

    expect(result.branchName).toBe('roleflock/task-1');
    expect(
      execFileSync('git', ['--git-dir', remote, 'show-ref', 'refs/heads/roleflock/task-1'], {
        encoding: 'utf8',
      }),
    ).toContain('refs/heads/roleflock/task-1');
  });

  it('returns only the selected staged or unstaged file diff', async () => {
    const { root, worktree } = fixture();
    writeFileSync(join(root, 'README.md'), '# RoleFlock\n\nGoverned changes.\n');
    writeFileSync(join(root, 'NEW.txt'), 'A new file\n');

    const tracked = await inspectTaskFileDiff(worktree, 'README.md', false);
    expect(tracked.patch).toContain('+Governed changes.');
    expect(tracked.patch).not.toContain('NEW.txt');
    expect(tracked.added).toBe(2);

    const untracked = await inspectTaskFileDiff(worktree, 'NEW.txt', false);
    expect(untracked.patch).toContain('A new file');
    expect(untracked.patch).not.toContain('README.md');

    await stageTaskFiles(worktree, ['README.md']);
    const staged = await inspectTaskFileDiff(worktree, 'README.md', true);
    expect(staged.patch).toContain('+Governed changes.');
    await expect(inspectTaskFileDiff(worktree, 'README.md', false)).rejects.toThrow(
      'No unstaged changes',
    );
    await expect(inspectTaskFileDiff(worktree, '../outside.txt', false)).rejects.toThrow(
      'not part of this task workspace',
    );
  });
});
