import { existsSync, mkdtempSync, rmSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  WriterLease,
  assertSafePath,
  createWorktree,
  DirtyWorkingTreeError,
  prepareTaskWorkspace,
  initializeEmptyRepository,
  registerRepository,
  releaseInPlaceWorkspace,
} from './index.js';

const dirs: string[] = [];
afterEach(() => {
  WriterLease.clearAll();
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'rf-repo-'));
  dirs.push(dir);
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@roleflock.local'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'RoleFlock'], { cwd: dir });
  writeFileSync(join(dir, 'README.md'), '# fixture\n');
  writeFileSync(join(dir, '.env'), 'SECRET=1\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
  return dir;
}

describe('repository-runtime', () => {
  it('classifies a plain folder and an empty Git repository before registration', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'rf-plain-'));
    dirs.push(plain);
    await expect(registerRepository(plain)).rejects.toMatchObject({
      code: 'NOT_GIT_REPOSITORY',
    });

    execFileSync('git', ['init'], { cwd: plain });
    await expect(registerRepository(plain)).rejects.toMatchObject({
      code: 'NO_INITIAL_COMMIT',
    });
  });

  it('initializes an empty project with a safe empty first commit', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'rf-new-project-'));
    dirs.push(plain);

    const repository = await initializeEmptyRepository(plain);

    expect(repository.root).toBe(realpathSync(plain));
    expect(
      execFileSync('git', ['-C', plain, 'branch', '--show-current'], {
        encoding: 'utf8',
      }).trim(),
    ).toBe('main');
    expect(
      execFileSync('git', ['-C', plain, 'log', '-1', '--pretty=%s'], {
        encoding: 'utf8',
      }).trim(),
    ).toBe('Initial commit');
    expect(execFileSync('git', ['-C', plain, 'status', '--porcelain'], { encoding: 'utf8' })).toBe(
      '',
    );
  });

  it('does not initialize or stage a non-empty folder', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'rf-existing-project-'));
    dirs.push(plain);
    writeFileSync(join(plain, '.env'), 'SECRET=keep-me-out\n');

    await expect(initializeEmptyRepository(plain)).rejects.toMatchObject({
      code: 'NON_EMPTY_NON_GIT_DIRECTORY',
    });
    expect(existsSync(join(plain, '.git'))).toBe(false);
  });

  it('denies .env and symlink escapes', async () => {
    const root = tempRepo();
    const repo = await registerRepository(root);
    await expect(assertSafePath(repo, '.env')).rejects.toThrow(/denied/);
    const outside = mkdtempSync(join(tmpdir(), 'rf-out-'));
    dirs.push(outside);
    writeFileSync(join(outside, 'secret.txt'), 'x');
    symlinkSync(outside, join(root, 'escape-link'));
    await expect(assertSafePath(repo, 'escape-link/secret.txt')).rejects.toThrow();
  });

  it('creates external worktree and enforces one writer', async () => {
    const root = tempRepo();
    const repo = await registerRepository(root);
    const base = mkdtempSync(join(tmpdir(), 'rf-wt-'));
    dirs.push(base);
    const resolvedBase = realpathSync(base);
    const wt = await createWorktree(repo, 'task1', { worktreeBaseDir: base });
    expect(wt.path.startsWith(resolvedBase)).toBe(true);
    const a = new WriterLease(wt.path, 'writer-a');
    const b = new WriterLease(wt.path, 'writer-b');
    expect(a.acquire()).toBe(true);
    expect(b.acquire()).toBe(false);
    a.release();
    expect(b.acquire()).toBe(true);
  });

  it('prepares an in-place task branch inside the project folder', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rf-inplace-'));
    dirs.push(root);
    execFileSync('git', ['init'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@roleflock.local'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'RoleFlock'], { cwd: root });
    writeFileSync(join(root, 'README.md'), '# fixture\n');
    execFileSync('git', ['add', 'README.md'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: root });
    execFileSync('git', ['branch', '-M', 'main'], { cwd: root });

    const repo = await registerRepository(root);
    const workspace = await prepareTaskWorkspace(repo, 'task-in-place', { mode: 'in_place' });

    expect(workspace.path).toBe(realpathSync(root));
    expect(workspace.branchName).toBe('roleflock/task-in-place');
    expect(workspace.mode).toBe('in_place');
    expect(
      execFileSync('git', ['-C', root, 'branch', '--show-current'], { encoding: 'utf8' }).trim(),
    ).toBe('roleflock/task-in-place');

    writeFileSync(join(root, 'note.html'), '<h1>hi</h1>\n');
    expect(existsSync(join(root, 'note.html'))).toBe(true);

    const released = await releaseInPlaceWorkspace(root, 'roleflock/task-in-place', 'main');
    // Dirty tree must not force-checkout away from the user's edits.
    expect(released.restored).toBe(false);
  });

  it('refuses in-place start when the project folder is dirty on another branch', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rf-dirty-'));
    dirs.push(root);
    execFileSync('git', ['init'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@roleflock.local'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'RoleFlock'], { cwd: root });
    writeFileSync(join(root, 'README.md'), '# fixture\n');
    execFileSync('git', ['add', 'README.md'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: root });
    writeFileSync(join(root, 'dirty.txt'), 'wip\n');

    const repo = await registerRepository(root);
    await expect(
      prepareTaskWorkspace(repo, 'task-dirty', { mode: 'in_place' }),
    ).rejects.toBeInstanceOf(DirtyWorkingTreeError);
  });
});
