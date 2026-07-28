import { describe, expect, it } from 'vitest';
import { expectedPathsOverlap, predictExpectedPathCollisions } from './path-collision.js';

describe('expected path collision prediction', () => {
  it('detects exact, ancestor, and conservative pattern overlap', () => {
    expect(expectedPathsOverlap('src/checkout.ts', 'src/checkout.ts')).toBe(true);
    expect(expectedPathsOverlap('src/checkout', 'src/checkout/handler.ts')).toBe(true);
    expect(expectedPathsOverlap('src/features/**', 'src/features/cart.ts')).toBe(true);
    expect(expectedPathsOverlap('src/features/**', 'docs/guide.md')).toBe(false);
  });

  it('returns deterministic warnings bound to the conflicting plan hash', () => {
    const collisions = predictExpectedPathCollisions(
      {
        taskId: 'task-candidate',
        expectedChangedPaths: ['src/cart.ts', 'docs'],
      },
      [
        {
          taskId: 'task-active',
          id: 'plan-active',
          hash: 'a'.repeat(64),
          expectedChangedPaths: ['src/cart.ts', 'infra'],
        },
        {
          taskId: 'task-docs',
          id: 'plan-docs',
          hash: 'b'.repeat(64),
          expectedChangedPaths: ['docs/readme.md'],
        },
      ],
    );

    expect(collisions).toEqual([
      {
        taskId: 'task-active',
        planId: 'plan-active',
        planHash: 'a'.repeat(64),
        path: 'src/cart.ts',
        conflictingPath: 'src/cart.ts',
        kind: 'exact',
      },
      {
        taskId: 'task-docs',
        planId: 'plan-docs',
        planHash: 'b'.repeat(64),
        path: 'docs',
        conflictingPath: 'docs/readme.md',
        kind: 'ancestor',
      },
    ]);
  });
});
