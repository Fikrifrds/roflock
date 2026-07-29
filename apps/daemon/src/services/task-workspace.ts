import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
const exec = promisify(execFile);

/**
 * True only when the task is writing in the repository's primary checkout. A
 * linked worktree reports a git directory under the main repository, so the
 * two paths diverge.
 */
async function isPrimaryCheckout(worktreePath: string): Promise<boolean> {
  try {
    const [toplevel, commonDir] = await Promise.all([
      git(worktreePath, ['rev-parse', '--show-toplevel']),
      git(worktreePath, ['rev-parse', '--path-format=absolute', '--git-common-dir']),
    ]);
    const [resolvedTop, resolvedRoot] = await Promise.all([
      realpath(toplevel),
      realpath(dirname(commonDir)),
    ]);
    return resolvedTop === resolvedRoot;
  } catch {
    return false;
  }
}

type WorktreeRecord = {
  path: string;
  branchName: string;
  baseCommit: string;
  writerLeaseId?: string;
  status: 'active' | 'dirty_preserved' | 'archived' | 'deleted';
};

type PorcelainFile = {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  added: number;
  removed: number;
};

export type TaskWorkspaceSummary = {
  available: true;
  path: string;
  inPlace: boolean;
  branchName: string;
  baseCommit: string;
  headCommit: string;
  headSubject: string;
  writerLeaseActive: boolean;
  worktreeStatus: WorktreeRecord['status'];
  remote: string | null;
  ahead: number;
  behind: number;
  files: PorcelainFile[];
  patch: string;
  stagedPatch: string;
};

export type TaskFileDiff = {
  path: string;
  staged: boolean;
  patch: string;
  added: number;
  removed: number;
  binary: boolean;
};

async function git(worktree: string, args: string[]): Promise<string> {
  const result = await exec('git', ['-C', worktree, ...args], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return result.stdout.trimEnd();
}

async function gitDiffAllowChanges(worktree: string, args: string[]): Promise<string> {
  try {
    return await git(worktree, args);
  } catch (error) {
    const result = error as { code?: number; stdout?: string | Buffer };
    if (result.code === 1 && result.stdout !== undefined) return String(result.stdout).trimEnd();
    throw error;
  }
}

async function optionalGit(worktree: string, args: string[]): Promise<string | null> {
  try {
    return await git(worktree, args);
  } catch {
    return null;
  }
}

function parseStatus(status: string): PorcelainFile[] {
  return status
    .split('\n')
    .filter(Boolean)
    .map((line) => ({
      indexStatus: line[0] === ' ' ? '' : (line[0] ?? ''),
      worktreeStatus: line[1] === ' ' ? '' : (line[1] ?? ''),
      path: line.slice(3).replace(/^.* -> /, ''),
      added: 0,
      removed: 0,
    }));
}

function applyNumstat(files: PorcelainFile[], numstat: string): void {
  const byPath = new Map(files.map((file) => [file.path, file]));
  for (const line of numstat.split('\n')) {
    if (!line) continue;
    const [added, removed, ...pathParts] = line.split('\t');
    const path = pathParts.join('\t');
    const file = byPath.get(path);
    if (!file) continue;
    file.added = added === '-' ? 0 : Number(added);
    file.removed = removed === '-' ? 0 : Number(removed);
  }
}

export async function inspectTaskWorkspace(
  worktree: WorktreeRecord,
): Promise<TaskWorkspaceSummary> {
  const [status, patch, stagedPatch, headCommit, headSubject, remote, upstreamCounts] =
    await Promise.all([
      git(worktree.path, ['status', '--porcelain=v1', '--untracked-files=all']),
      git(worktree.path, ['diff', '--no-ext-diff', 'HEAD']),
      git(worktree.path, ['diff', '--no-ext-diff', '--cached']),
      git(worktree.path, ['rev-parse', '--short=10', 'HEAD']),
      git(worktree.path, ['log', '-1', '--pretty=%s']),
      optionalGit(worktree.path, ['remote', 'get-url', 'origin']),
      optionalGit(worktree.path, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']),
    ]);
  const files = parseStatus(status);
  applyNumstat(files, await git(worktree.path, ['diff', '--numstat', 'HEAD']));
  // Tasks default to an external worktree, so this was reporting "editing in
  // project folder" for changes that were nowhere near the project folder.
  const inPlace = await isPrimaryCheckout(worktree.path);
  const baseAhead = Number(
    (await optionalGit(worktree.path, ['rev-list', '--count', `${worktree.baseCommit}..HEAD`])) ??
      0,
  );
  const [behind = 0, upstreamAhead = baseAhead] = upstreamCounts
    ? upstreamCounts.trim().split(/\s+/).map(Number)
    : [0, baseAhead];
  return {
    available: true,
    path: worktree.path,
    inPlace,
    branchName: worktree.branchName,
    baseCommit: worktree.baseCommit,
    headCommit,
    headSubject,
    writerLeaseActive: Boolean(worktree.writerLeaseId),
    worktreeStatus: worktree.status,
    remote,
    ahead: Number.isFinite(upstreamAhead) ? upstreamAhead : 0,
    behind: Number.isFinite(behind) ? behind : 0,
    files,
    patch,
    stagedPatch,
  };
}

export async function inspectTaskFileDiff(
  worktree: WorktreeRecord,
  path: string,
  staged: boolean,
): Promise<TaskFileDiff> {
  const summary = await inspectTaskWorkspace(worktree);
  const file = summary.files.find((entry) => entry.path === path);
  if (!file) throw new Error('File is not part of this task workspace change set.');

  const hasRequestedChange = staged
    ? Boolean(file.indexStatus && file.indexStatus !== '?')
    : Boolean(file.worktreeStatus || file.indexStatus === '?');
  if (!hasRequestedChange) {
    throw new Error(`No ${staged ? 'staged' : 'unstaged'} changes for ${path}.`);
  }

  const untracked = !staged && file.indexStatus === '?';
  const diffArgs = untracked
    ? ['diff', '--no-index', '--no-ext-diff', '--', '/dev/null', path]
    : ['diff', '--no-ext-diff', ...(staged ? ['--cached'] : []), '--', path];
  const numstatArgs = untracked
    ? ['diff', '--no-index', '--numstat', '--', '/dev/null', path]
    : ['diff', ...(staged ? ['--cached'] : []), '--numstat', '--', path];
  const [patch, numstat] = await Promise.all([
    untracked ? gitDiffAllowChanges(worktree.path, diffArgs) : git(worktree.path, diffArgs),
    untracked ? gitDiffAllowChanges(worktree.path, numstatArgs) : git(worktree.path, numstatArgs),
  ]);
  const [addedValue = '0', removedValue = '0'] = numstat.split('\t');
  const binary = addedValue === '-' || removedValue === '-';

  return {
    path,
    staged,
    patch,
    added: binary ? 0 : Number(addedValue) || 0,
    removed: binary ? 0 : Number(removedValue) || 0,
    binary,
  };
}

export async function stageTaskFiles(worktree: WorktreeRecord, paths: string[]): Promise<void> {
  await git(worktree.path, paths.length ? ['add', '--', ...paths] : ['add', '--all']);
}

export async function unstageTaskFiles(worktree: WorktreeRecord, paths: string[]): Promise<void> {
  await git(worktree.path, paths.length ? ['reset', '--', ...paths] : ['reset']);
}

export async function commitTaskWorkspace(
  worktree: WorktreeRecord,
  message: string,
): Promise<{ commit: string }> {
  await git(worktree.path, ['commit', '-m', message]);
  return { commit: await git(worktree.path, ['rev-parse', 'HEAD']) };
}

export async function pushTaskWorkspace(
  worktree: WorktreeRecord,
): Promise<{ branchName: string; remote: string }> {
  const remote = await optionalGit(worktree.path, ['remote', 'get-url', 'origin']);
  if (!remote) throw new Error('This repository has no origin remote.');
  await git(worktree.path, ['push', '--set-upstream', 'origin', worktree.branchName]);
  return { branchName: worktree.branchName, remote };
}
