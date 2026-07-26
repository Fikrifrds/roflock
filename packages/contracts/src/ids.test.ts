import { describe, expect, it } from 'vitest';
import { FakeClock, canonicalize, createId, sha256Canonical } from './ids.js';
import { CreateTaskCommandSchema, TaskTypeSchema } from './schemas.js';

describe('contracts', () => {
  it('creates prefixed ids', () => {
    expect(createId('task')).toMatch(/^task_/);
  });

  it('canonicalizes objects stably', () => {
    const a = canonicalize({ b: 1, a: 2 });
    const b = canonicalize({ a: 2, b: 1 });
    expect(a).toBe(b);
    expect(sha256Canonical({ b: 1, a: 2 })).toBe(sha256Canonical({ a: 2, b: 1 }));
  });

  it('validates create task command', () => {
    const parsed = CreateTaskCommandSchema.parse({
      projectId: 'proj_1',
      type: 'bug_fix',
      title: 'Fix crash',
      brief: 'App crashes on save',
    });
    expect(parsed.type).toBe('bug_fix');
    expect(parsed.maxAttempts).toBe(3);
  });

  it('rejects invalid task type', () => {
    expect(() => TaskTypeSchema.parse('unknown')).toThrow();
  });

  it('fake clock advances', () => {
    const clock = new FakeClock();
    const before = clock.now().getTime();
    clock.advance(1000);
    expect(clock.now().getTime() - before).toBe(1000);
  });
});
