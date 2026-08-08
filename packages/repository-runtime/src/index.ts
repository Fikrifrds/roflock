import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, realpath, lstat, access, stat, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

const exec = promisify(execFile);

export interface Repository {
  root: string;
  gitDir: string;
  deniedPathGlobs: string[];
}

export type RepositoryRegistrationErrorCode =
  | 'PATH_NOT_FOUND'
  | 'NOT_A_DIRECTORY'
  | 'NOT_GIT_REPOSITORY'
  | 'NO_INITIAL_COMMIT'
  | 'NON_EMPTY_NON_GIT_DIRECTORY';

export class RepositoryRegistrationError extends Error {
  constructor(
    readonly code: RepositoryRegistrationErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'RepositoryRegistrationError';
  }
}

export const DEFAULT_DENIED_GLOBS = [
  '.env',
  '.env.*',
  '**/.env',
  '**/.env.*',
  '**/*secret*',
  '**/*credential*',
  '**/id_rsa*',
  '**/*.pem',
  '**/*.key',
];

async function resolveProjectDirectory(path: string): Promise<string> {
  let root: string;
  try {
    root = await realpath(path);
  } catch (error) {
    throw new RepositoryRegistrationError(
      'PATH_NOT_FOUND',
      `Folder does not exist or cannot be accessed: ${path}`,
      { cause: error },
    );
  }
  if (!(await stat(root)).isDirectory()) {
    throw new RepositoryRegistrationError(
      'NOT_A_DIRECTORY',
      `Project path must be a folder: ${path}`,
    );
  }
  return root;
}

export async function registerRepository(
  path: string,
  deniedPathGlobs = DEFAULT_DENIED_GLOBS,
): Promise<Repository> {
  const root = await resolveProjectDirectory(path);
  let stdout: string;
  try {
    ({ stdout } = await exec('git', ['-C', root, 'rev-parse', '--is-inside-work-tree']));
  } catch (error) {
    throw new RepositoryRegistrationError(
      'NOT_GIT_REPOSITORY',
      'This folder is not a Git repository. Initialize Git and create an initial commit first, then add it again.',
      { cause: error },
    );
  }
  if (stdout.trim() !== 'true') {
    throw new RepositoryRegistrationError(
      'NOT_GIT_REPOSITORY',
      'This folder is not a Git work tree. Initialize Git and create an initial commit first, then add it again.',
    );
  }

  try {
    await exec('git', ['-C', root, 'rev-parse', '--verify', 'HEAD']);
  } catch (error) {
    throw new RepositoryRegistrationError(
      'NO_INITIAL_COMMIT',
      'This Git repository has no commits yet. Create an initial commit first, then add it again.',
      { cause: error },
    );
  }
  const gitDirRaw = await exec('git', ['-C', root, 'rev-parse', '--git-dir']);
  return {
    root,
    gitDir: await realpath(resolve(root, gitDirRaw.stdout.trim())),
    deniedPathGlobs,
  };
}

/**
 * Bootstraps a brand-new project without staging any user files. Restricting
 * this to a truly empty folder prevents an innocent "Add project" click from
 * committing secrets or an existing unreviewed codebase.
 */
export async function initializeEmptyRepository(
  path: string,
  deniedPathGlobs = DEFAULT_DENIED_GLOBS,
): Promise<Repository> {
  const root = await resolveProjectDirectory(path);
  const entries = await readdir(root);
  if (entries.length > 0) {
    throw new RepositoryRegistrationError(
      'NON_EMPTY_NON_GIT_DIRECTORY',
      'This folder is not a Git repository and already contains files. Initialize and review Git manually before adding it.',
    );
  }

  await exec('git', ['-C', root, 'init', '--initial-branch=main']);
  await exec('git', [
    '-C',
    root,
    '-c',
    'user.name=RoleFlock',
    '-c',
    'user.email=roleflock@local.invalid',
    'commit',
    '--allow-empty',
    '-m',
    'Initial commit',
  ]);
  return registerRepository(root, deniedPathGlobs);
}

export function matchesGlob(path: string, glob: string): boolean {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§')
    .replace(/\*/g, '[^/]*')
    .replace(/§/g, '.*');
  return new RegExp(`^${escaped}$`).test(path.replaceAll('\\', '/'));
}

export async function assertSafePath(repo: Repository, candidate: string): Promise<string> {
  const absolute = isAbsolute(candidate) ? candidate : resolve(repo.root, candidate);
  const lexical = relative(repo.root, absolute).replaceAll('\\', '/');
  if (lexical.startsWith('..') || isAbsolute(lexical)) {
    throw new Error(`Path denied by repository policy: ${candidate}`);
  }
  if (lexical !== '' && repo.deniedPathGlobs.some((g) => matchesGlob(lexical, g))) {
    throw new Error(`Path denied by repository policy: ${candidate}`);
  }
  try {
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) {
      throw new Error(`Symlink denied: ${candidate}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const existingAncestor = await nearestExisting(absolute);
  const actual = await realpath(existingAncestor);
  if (relative(repo.root, actual).startsWith('..')) {
    throw new Error(`Path escapes repository via symlink: ${candidate}`);
  }
  return absolute;
}

async function nearestExisting(path: string): Promise<string> {
  try {
    await lstat(path);
    return path;
  } catch {
    const parent = resolve(path, '..');
    if (parent === path) throw new Error('No existing ancestor');
    return nearestExisting(parent);
  }
}

export async function createWorktree(
  repo: Repository,
  taskId: string,
  options: { baseRef?: string; worktreeBaseDir: string },
): Promise<{ path: string; branchName: string; baseCommit: string }> {
  const baseRef = options.baseRef ?? 'HEAD';
  const { stdout: baseCommit } = await exec('git', ['-C', repo.root, 'rev-parse', baseRef]);
  const branchName = `roleflock/${taskId}`;
  const path = join(options.worktreeBaseDir, taskId);
  await mkdir(options.worktreeBaseDir, { recursive: true });
  try {
    await access(path, constants.F_OK);
    // Already exists — reuse for recovery
    return { path: await realpath(path), branchName, baseCommit: baseCommit.trim() };
  } catch {
    // create new
  }
  try {
    await exec('git', ['-C', repo.root, 'branch', branchName, baseCommit.trim()]);
  } catch {
    // branch may already exist after restart
  }
  await exec('git', ['-C', repo.root, 'worktree', 'add', '--force', path, branchName]);
  return { path: await realpath(path), branchName, baseCommit: baseCommit.trim() };
}

export type TaskWorkspaceMode = 'in_place' | 'external';

export class DirtyWorkingTreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DirtyWorkingTreeError';
  }
}

async function gitStdout(repoRoot: string, args: string[]): Promise<string> {
  return (await exec('git', ['-C', repoRoot, ...args])).stdout.trim();
}

/**
 * Prepares the task workspace. New tasks default to an external worktree so
 * RoleFlock never changes the branch or dirty state of the user's primary
 * checkout. In-place mode remains an explicit compatibility path only.
 */
export async function prepareTaskWorkspace(
  repo: Repository,
  taskId: string,
  options: {
    mode?: TaskWorkspaceMode;
    baseRef?: string;
    worktreeBaseDir?: string;
  } = {},
): Promise<{ path: string; branchName: string; baseCommit: string; mode: TaskWorkspaceMode }> {
  const mode = options.mode ?? 'external';
  if (mode === 'external') {
    if (!options.worktreeBaseDir) {
      throw new Error('worktreeBaseDir is required for external task workspaces');
    }
    const created = await createWorktree(repo, taskId, {
      baseRef: options.baseRef,
      worktreeBaseDir: options.worktreeBaseDir,
    });
    return { ...created, mode };
  }

  const baseRef = options.baseRef ?? 'HEAD';
  const baseCommit = await gitStdout(repo.root, ['rev-parse', baseRef]);
  const branchName = `roleflock/${taskId}`;
  const status = await gitStdout(repo.root, ['status', '--porcelain']);
  const currentBranch = await gitStdout(repo.root, ['branch', '--show-current']);

  if (status && currentBranch !== branchName) {
    throw new DirtyWorkingTreeError(
      'Project folder has uncommitted changes. Commit, stash, or discard them before starting a Roflock task here.',
    );
  }

  const branchExists = await exec('git', ['-C', repo.root, 'rev-parse', '--verify', branchName])
    .then(() => true)
    .catch(() => false);

  if (!branchExists) {
    await exec('git', ['-C', repo.root, 'branch', branchName, baseCommit]);
  }

  if (currentBranch !== branchName) {
    await exec('git', ['-C', repo.root, 'checkout', branchName]);
  }

  return {
    path: await realpath(repo.root),
    branchName,
    baseCommit,
    mode: 'in_place',
  };
}

/**
 * Leaves the task branch when safe. Never deletes the project folder.
 * Returns whether the checkout was restored to the base branch.
 */
export async function releaseInPlaceWorkspace(
  repoRoot: string,
  branchName: string,
  baseBranch = 'main',
): Promise<{ restored: boolean }> {
  const root = await realpath(repoRoot);
  const currentBranch = await gitStdout(root, ['branch', '--show-current']).catch(() => '');
  if (currentBranch !== branchName) return { restored: false };

  const status = await gitStdout(root, ['status', '--porcelain']);
  if (status) return { restored: false };

  const hasBase = await exec('git', ['-C', root, 'rev-parse', '--verify', baseBranch])
    .then(() => true)
    .catch(() => false);
  if (!hasBase) return { restored: false };

  await exec('git', ['-C', root, 'checkout', baseBranch]);
  return { restored: true };
}

export async function captureDiff(worktreePath: string): Promise<{
  status: string;
  patch: string;
  changedFiles: string[];
  added: number;
  removed: number;
}> {
  const status = (await exec('git', ['-C', worktreePath, 'status', '--porcelain'])).stdout;
  const patch = (await exec('git', ['-C', worktreePath, 'diff', 'HEAD'])).stdout;
  const changedFiles = status
    .split('\n')
    .map((line) => line.trim().slice(3).trim())
    .filter(Boolean);
  let added = 0;
  let removed = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) added += 1;
    else if (line.startsWith('-') && !line.startsWith('---')) removed += 1;
  }
  return { status, patch, changedFiles, added, removed };
}

export async function preserveWorktree(worktreePath: string): Promise<void> {
  await realpath(worktreePath);
}

export class WriterLease {
  private static owners = new Map<string, string>();

  constructor(
    public readonly worktree: string,
    public readonly owner: string,
  ) {}

  acquire(): boolean {
    const current = WriterLease.owners.get(this.worktree);
    if (current && current !== this.owner) return false;
    WriterLease.owners.set(this.worktree, this.owner);
    return true;
  }

  release(): void {
    if (WriterLease.owners.get(this.worktree) === this.owner) {
      WriterLease.owners.delete(this.worktree);
    }
  }

  static holder(worktree: string): string | undefined {
    return WriterLease.owners.get(worktree);
  }

  static clear(worktree: string): void {
    WriterLease.owners.delete(worktree);
  }

  static clearAll(): void {
    WriterLease.owners.clear();
  }
}
