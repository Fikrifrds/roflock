import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createCleanVerifierWorktree, removeCleanVerifierWorktree } from './verifier-worktree.js';

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

describe('clean verifier worktree lifecycle', () => {
  it('checks the exact result commit without exposing dirty writer state', async () => {
    const repository = mkdtempSync(join(tmpdir(), 'roleflock-verifier-repo-'));
    const verifierBase = mkdtempSync(join(tmpdir(), 'roleflock-verifier-worktrees-'));
    directories.push(repository, verifierBase);
    git(repository, ['init']);
    git(repository, ['config', 'user.email', 'test@roleflock.local']);
    git(repository, ['config', 'user.name', 'RoleFlock Test']);
    writeFileSync(join(repository, 'result.txt'), 'base\n');
    git(repository, ['add', 'result.txt']);
    git(repository, ['commit', '-m', 'base']);
    writeFileSync(join(repository, 'result.txt'), 'committed result\n');
    git(repository, ['add', 'result.txt']);
    git(repository, ['commit', '-m', 'result']);
    const resultCommit = git(repository, ['rev-parse', 'HEAD']);

    // This is writer state created after the result commit. A verifier that
    // reads the writer filesystem would observe both changes and be compromised.
    writeFileSync(join(repository, 'result.txt'), 'dirty writer rewrite\n');
    writeFileSync(join(repository, 'writer-secret.txt'), 'must not be visible\n');

    const verifier = await createCleanVerifierWorktree({
      repositoryRoot: repository,
      resultCommit,
      baseDirectory: verifierBase,
      runId: 'verification-run-1',
      createdAt: '2026-07-28T10:00:00.000Z',
    });

    expect(verifier.resultCommit).toBe(resultCommit);
    expect(readFileSync(join(verifier.path, 'result.txt'), 'utf8')).toBe('committed result\n');
    expect(existsSync(join(verifier.path, 'writer-secret.txt'))).toBe(false);
    expect(git(verifier.path, ['status', '--porcelain', '--untracked-files=all'])).toBe('');
    expect(git(verifier.path, ['rev-parse', 'HEAD'])).toBe(resultCommit);

    await removeCleanVerifierWorktree(verifier, verifierBase);
    expect(existsSync(verifier.path)).toBe(false);
    expect(git(repository, ['worktree', 'list', '--porcelain'])).not.toContain(verifier.path);
  });

  it('rejects unsafe run identifiers before creating a path', async () => {
    await expect(
      createCleanVerifierWorktree({
        repositoryRoot: '/tmp',
        resultCommit: 'a'.repeat(40),
        baseDirectory: '/tmp/verifier',
        runId: '../escape',
      }),
    ).rejects.toThrow(/unsafe/);
  });
});

function git(directory: string, args: string[]): string {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
}
