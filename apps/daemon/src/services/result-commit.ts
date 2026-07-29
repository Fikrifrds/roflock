import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const TaskIdSchema = /^[A-Za-z0-9._-]{1,120}$/;

/**
 * The identity a sealed result commit is authored under.
 *
 * Deliberately not the user's git identity: this commit is a runtime artifact
 * of the assurance pipeline, not a change the human wrote, and it must not
 * inherit an authorship claim from whoever happens to own the checkout.
 */
const SEAL_IDENTITY = {
  GIT_AUTHOR_NAME: 'RoleFlock Runner',
  GIT_AUTHOR_EMAIL: 'runner@roleflock.local',
  GIT_COMMITTER_NAME: 'RoleFlock Runner',
  GIT_COMMITTER_EMAIL: 'runner@roleflock.local',
} as const;

export interface SealedResultCommit {
  resultCommit: string;
  parentCommit: string;
  ref: string;
  treeId: string;
  treeDigest: string;
  diffDigest: string;
  changedPaths: string[];
  /** False when the executor left the worktree identical to its base. */
  changed: boolean;
}

/**
 * Turns whatever the executor left in its worktree into an immutable commit
 * that independent verification can be run against.
 *
 * Verification has to read a commit rather than a live filesystem — a dirty
 * worktree can change under the verifier, and evidence that cannot name the
 * exact bytes it judged is not evidence. But committing onto the task branch
 * would take the human's review-and-commit step away from them, so this seals
 * the state into a detached commit object held alive by a RoleFlock-owned ref
 * and leaves the branch, the index, and the working tree exactly as they were.
 */
export async function sealResultCommit(input: {
  worktreePath: string;
  taskId: string;
  baseCommit: string;
  message: string;
}): Promise<SealedResultCommit> {
  if (!TaskIdSchema.test(input.taskId)) throw new Error(`Unsafe task identity: ${input.taskId}`);
  const indexDirectory = await mkdtemp(join(tmpdir(), 'roleflock-seal-'));
  try {
    const env = { ...process.env, ...SEAL_IDENTITY, GIT_INDEX_FILE: join(indexDirectory, 'index') };
    const parentCommit = await git(input.worktreePath, ['rev-parse', 'HEAD']);

    // A scratch index keeps `git add` off the index the user is staging into.
    await git(input.worktreePath, ['read-tree', parentCommit], env);
    await git(input.worktreePath, ['add', '--all', '--', '.'], env);
    const treeId = await git(input.worktreePath, ['write-tree'], env);
    const resultCommit = await git(
      input.worktreePath,
      ['commit-tree', treeId, '-p', parentCommit, '-m', input.message],
      env,
    );

    const ref = `refs/roleflock/results/${input.taskId}/${resultCommit}`;
    await git(input.worktreePath, ['update-ref', ref, resultCommit]);

    const changedPaths = await diffNames(input.worktreePath, input.baseCommit, resultCommit);
    const patch = await git(input.worktreePath, [
      'diff',
      '--no-ext-diff',
      '--no-color',
      input.baseCommit,
      resultCommit,
    ]);
    return {
      resultCommit,
      parentCommit,
      ref,
      treeId,
      treeDigest: digest(treeId),
      diffDigest: digest(patch),
      changedPaths,
      changed: changedPaths.length > 0,
    };
  } finally {
    await rm(indexDirectory, { recursive: true, force: true });
  }
}

/**
 * Recomputes the subject digests for a commit that was sealed by an earlier
 * run, so acceptance after a daemon restart still binds the passport to the
 * exact bytes that were verified rather than skipping issuance.
 */
export async function describeSealedCommit(input: {
  worktreePath: string;
  baseCommit: string;
  resultCommit: string;
}): Promise<Pick<SealedResultCommit, 'treeDigest' | 'diffDigest' | 'changedPaths'>> {
  const treeId = await git(input.worktreePath, ['rev-parse', `${input.resultCommit}^{tree}`]);
  const patch = await git(input.worktreePath, [
    'diff',
    '--no-ext-diff',
    '--no-color',
    input.baseCommit,
    input.resultCommit,
  ]);
  return {
    treeDigest: digest(treeId),
    diffDigest: digest(patch),
    changedPaths: await diffNames(input.worktreePath, input.baseCommit, input.resultCommit),
  };
}

/**
 * The main checkout backing a linked worktree, which is where `git worktree
 * add` for the verifier has to be issued from.
 */
export async function resolveRepositoryRoot(worktreePath: string): Promise<string> {
  const commonDir = await git(worktreePath, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]);
  return dirname(commonDir);
}

async function diffNames(cwd: string, from: string, to: string): Promise<string[]> {
  const { stdout } = await exec('git', ['-C', cwd, 'diff', '--name-only', '-z', from, to, '--'], {
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout.toString('utf8').split('\0').filter(Boolean).sort();
}

async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await exec('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...(env ? { env } : {}),
  });
  return stdout.trim();
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
