import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, realpath, lstat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

const exec = promisify(execFile);

export interface Repository {
  root: string;
  gitDir: string;
  deniedPathGlobs: string[];
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

export async function registerRepository(
  path: string,
  deniedPathGlobs = DEFAULT_DENIED_GLOBS,
): Promise<Repository> {
  const root = await realpath(path);
  const { stdout } = await exec('git', ['-C', root, 'rev-parse', '--is-inside-work-tree']);
  if (stdout.trim() !== 'true') {
    throw new Error(`Not a Git work tree: ${path}`);
  }
  const gitDirRaw = await exec('git', ['-C', root, 'rev-parse', '--git-dir']);
  return {
    root,
    gitDir: await realpath(resolve(root, gitDirRaw.stdout.trim())),
    deniedPathGlobs,
  };
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
  await exec('git', [
    '-C',
    repo.root,
    'worktree',
    'add',
    '--force',
    path,
    branchName,
  ]);
  return { path: await realpath(path), branchName, baseCommit: baseCommit.trim() };
}

export async function captureDiff(worktreePath: string): Promise<{
  status: string;
  patch: string;
  changedFiles: string[];
}> {
  const status = (await exec('git', ['-C', worktreePath, 'status', '--porcelain'])).stdout;
  const patch = (await exec('git', ['-C', worktreePath, 'diff', 'HEAD'])).stdout;
  const changedFiles = status
    .split('\n')
    .map((line) => line.trim().slice(3).trim())
    .filter(Boolean);
  return { status, patch, changedFiles };
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

  static clearAll(): void {
    WriterLease.owners.clear();
  }
}
