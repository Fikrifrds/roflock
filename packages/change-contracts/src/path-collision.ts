import { posix } from 'node:path';
import type { ExecutionPlan } from './execution-artifacts.js';

export type ExpectedPathCollision = {
  taskId: string;
  planId: string;
  planHash: string;
  path: string;
  conflictingPath: string;
  kind: 'exact' | 'ancestor' | 'pattern';
};

export function predictExpectedPathCollisions(
  candidate: Pick<ExecutionPlan, 'taskId' | 'expectedChangedPaths'>,
  activePlans: Array<Pick<ExecutionPlan, 'taskId' | 'id' | 'hash' | 'expectedChangedPaths'>>,
): ExpectedPathCollision[] {
  const collisions: ExpectedPathCollision[] = [];
  for (const plan of activePlans) {
    if (plan.taskId === candidate.taskId) continue;
    for (const candidatePath of candidate.expectedChangedPaths) {
      for (const activePath of plan.expectedChangedPaths) {
        const kind = overlapKind(candidatePath, activePath);
        if (kind === undefined) continue;
        collisions.push({
          taskId: plan.taskId,
          planId: plan.id,
          planHash: plan.hash,
          path: normalize(candidatePath),
          conflictingPath: normalize(activePath),
          kind,
        });
      }
    }
  }
  return collisions.sort((left, right) =>
    [left.taskId, left.path, left.conflictingPath, left.planHash]
      .join('\0')
      .localeCompare([right.taskId, right.path, right.conflictingPath, right.planHash].join('\0')),
  );
}

export function expectedPathsOverlap(left: string, right: string): boolean {
  return overlapKind(left, right) !== undefined;
}

function overlapKind(
  leftInput: string,
  rightInput: string,
): ExpectedPathCollision['kind'] | undefined {
  const left = normalize(leftInput);
  const right = normalize(rightInput);
  if (left === right) return 'exact';
  const leftPattern = hasPattern(left);
  const rightPattern = hasPattern(right);
  if (!leftPattern && !rightPattern) {
    return contains(left, right) || contains(right, left) ? 'ancestor' : undefined;
  }

  // Pattern intersection is intentionally conservative. If the literal
  // prefixes can share a subtree, RoleFlock warns; it never claims this signal
  // proves that both writers will touch the same file.
  const leftPrefix = literalPrefix(left);
  const rightPrefix = literalPrefix(right);
  if (
    leftPrefix === '' ||
    rightPrefix === '' ||
    contains(leftPrefix, rightPrefix) ||
    contains(rightPrefix, leftPrefix)
  ) {
    return 'pattern';
  }
  return undefined;
}

function normalize(path: string): string {
  return posix.normalize(path.replaceAll('\\', '/')).replace(/^\.\//, '').replace(/\/+$/, '');
}

function contains(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

function hasPattern(path: string): boolean {
  return /[*?[\]{}]/.test(path);
}

function literalPrefix(path: string): string {
  const wildcard = path.search(/[*?[\]{}]/);
  if (wildcard === -1) return path;
  return path.slice(0, wildcard).replace(/\/+$/, '');
}
