import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

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

async function git(worktree: string, args: string[]): Promise<string> {
  const result = await exec('git', ['-C', worktree, ...args], {
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  return result.stdout.trimEnd();
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
  const baseAhead = Number(
    (await optionalGit(worktree.path, ['rev-list', '--count', `${worktree.baseCommit}..HEAD`])) ??
      0,
  );
  const [behind = 0, upstreamAhead = baseAhead] = upstreamCounts
    ? upstreamCounts.trim().split(/\s+/).map(Number)
    : [0, baseAhead];
  return {
    available: true,
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
