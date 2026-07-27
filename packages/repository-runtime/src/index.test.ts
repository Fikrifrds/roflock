import { mkdtempSync, rmSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { WriterLease, assertSafePath, createWorktree, registerRepository } from './index.js';

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
});
