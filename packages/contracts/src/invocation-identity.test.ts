import { describe, expect, it } from 'vitest';
import { stableInvocationKey, type InvocationIdentity } from './invocation-identity.js';

const base: InvocationIdentity = {
  taskId: 'task_1',
  graphVersionId: 'bug_fix@3',
  semanticHash: 'sha256:abc',
  nodeId: 'writer',
  attempt: 1,
  loopIteration: 0,
};

describe('stable invocation identity', () => {
  it('is the same for the same turn', () => {
    // The whole point: a process that did not start the work can still
    // recognise it.
    expect(stableInvocationKey(base)).toBe(stableInvocationKey({ ...base }));
  });

  it.each([
    ['task', { taskId: 'task_2' }],
    ['graph version', { graphVersionId: 'bug_fix@2' }],
    ['node', { nodeId: 'test' }],
    ['attempt', { attempt: 2 }],
    ['loop iteration', { loopIteration: 1 }],
  ])('differs when the %s differs', (_label, change) => {
    expect(stableInvocationKey({ ...base, ...change })).not.toBe(stableInvocationKey(base));
  });

  it('differs when the workflow source changed under an unchanged version id', () => {
    // A `.roflock` edit produces a new graph that still calls itself bug_fix@3.
    // Without the semantic hash, a turn paid for under the old shape would look
    // like one already done under the new one.
    expect(stableInvocationKey({ ...base, semanticHash: 'sha256:def' })).not.toBe(
      stableInvocationKey(base),
    );
  });

  it('distinguishes a graph with no semantic hash from one that has any', () => {
    const { semanticHash: _omitted, ...withoutHash } = base;

    expect(stableInvocationKey(withoutHash)).not.toBe(stableInvocationKey(base));
  });

  it('cannot be collided by ids containing separators', () => {
    // Concatenating fields would let these two describe one key.
    const a = stableInvocationKey({ ...base, taskId: 'a', nodeId: 'b:c' });
    const b = stableInvocationKey({ ...base, taskId: 'a:b', nodeId: 'c' });

    expect(a).not.toBe(b);
  });

  it('is a printable identifier', () => {
    expect(stableInvocationKey(base)).toMatch(/^inv_[0-9a-f]{64}$/);
  });
});
