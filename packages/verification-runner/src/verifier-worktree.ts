import { execFile } from 'node:child_process';
import { access, mkdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const CommitSchema = /^[a-f0-9]{7,64}$/;
const RunIdSchema = /^[a-zA-Z0-9._-]{1,160}$/;

export type CleanVerifierWorktree = {
  path: string;
  repositoryRoot: string;
  resultCommit: string;
  runId: string;
  createdAt: string;
};

export async function createCleanVerifierWorktree(input: {
  repositoryRoot: string;
  resultCommit: string;
  baseDirectory: string;
  runId: string;
  createdAt?: string;
}): Promise<CleanVerifierWorktree> {
  if (!CommitSchema.test(input.resultCommit)) throw new Error('Result commit is invalid');
  if (!RunIdSchema.test(input.runId)) throw new Error('Verifier run ID is unsafe');
  const repositoryRoot = await realpath(input.repositoryRoot);
  const resultCommit = await git(repositoryRoot, [
    'rev-parse',
    '--verify',
    `${input.resultCommit}^{commit}`,
  ]);
  await mkdir(input.baseDirectory, { recursive: true });
  const baseDirectory = await realpath(input.baseDirectory);
  const destination = join(baseDirectory, input.runId);
  assertContained(baseDirectory, destination);
  if (await exists(destination)) {
    throw new Error(`Verifier worktree already exists: ${input.runId}`);
  }

  await git(repositoryRoot, ['worktree', 'add', '--detach', destination, resultCommit]);
  try {
    const path = await realpath(destination);
    assertContained(baseDirectory, path);
    const head = await git(path, ['rev-parse', 'HEAD']);
    if (head !== resultCommit) {
      throw new Error(`Verifier worktree HEAD mismatch: expected ${resultCommit}, actual ${head}`);
    }
    const status = await git(path, ['status', '--porcelain', '--untracked-files=all']);
    if (status !== '') throw new Error('Verifier worktree is not clean');
    return {
      path,
      repositoryRoot,
      resultCommit,
      runId: input.runId,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
  } catch (error) {
    await git(repositoryRoot, ['worktree', 'remove', '--force', destination]).catch(() => {});
    throw error;
  }
}

export async function removeCleanVerifierWorktree(
  worktree: CleanVerifierWorktree,
  baseDirectory: string,
): Promise<void> {
  const base = await realpath(baseDirectory);
  assertContained(base, worktree.path);
  const repositoryRoot = await realpath(worktree.repositoryRoot);
  await git(repositoryRoot, ['worktree', 'remove', '--force', worktree.path]);
  await git(repositoryRoot, ['worktree', 'prune']);
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function assertContained(baseDirectory: string, candidate: string): void {
  if (!isAbsolute(baseDirectory) || !isAbsolute(candidate)) {
    throw new Error('Verifier worktree paths must be absolute');
  }
  const child = relative(resolve(baseDirectory), resolve(candidate));
  if (child === '' || child.startsWith('..') || isAbsolute(child)) {
    throw new Error('Verifier worktree path escapes its dedicated base directory');
  }
}
