import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openMigratedDatabase } from './client.js';
import { ConcurrencyPolicyRepository } from './repositories/concurrency-policy-repository.js';

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function repository() {
  const directory = mkdtempSync(join(tmpdir(), 'roleflock-concurrency-'));
  directories.push(directory);
  const db = openMigratedDatabase(join(directory, 'test.db'));
  return { db, policies: new ConcurrencyPolicyRepository(db) };
}

describe('ConcurrencyPolicyRepository', () => {
  it('enforces global and project limits atomically while allowing idempotent recovery', () => {
    const { policies } = repository();
    expect(policies.getGlobal()).toMatchObject({ maxActiveTasks: 4, revision: 1 });
    expect(policies.getProject('project-a')).toMatchObject({
      scopeType: 'project',
      maxActiveTasks: 2,
    });
    policies.set('global', '*', 3, 1, '2026-07-28T10:00:00.000Z');
    policies.set('project', 'project-a', 1, 1, '2026-07-28T10:00:00.000Z');

    expect(policies.tryAcquire('task-a', 'project-a', '2026-07-28T10:01:00.000Z')).toMatchObject({
      admitted: true,
      reused: false,
    });
    expect(policies.tryAcquire('task-a', 'project-a', '2026-07-28T10:02:00.000Z')).toMatchObject({
      admitted: true,
      reused: true,
    });
    expect(policies.tryAcquire('task-b', 'project-a', '2026-07-28T10:02:00.000Z')).toMatchObject({
      admitted: false,
      limitingScope: 'project',
      active: 1,
      limit: 1,
    });

    expect(policies.tryAcquire('task-c', 'project-b', '2026-07-28T10:03:00.000Z')).toMatchObject({
      admitted: true,
    });
    expect(policies.tryAcquire('task-d', 'project-c', '2026-07-28T10:03:00.000Z')).toMatchObject({
      admitted: true,
    });
    expect(policies.tryAcquire('task-e', 'project-d', '2026-07-28T10:03:00.000Z')).toMatchObject({
      admitted: false,
      limitingScope: 'global',
      active: 3,
      limit: 3,
    });

    expect(policies.release('task-a', '2026-07-28T10:04:00.000Z')).toBe(true);
    expect(policies.tryAcquire('task-b', 'project-a', '2026-07-28T10:05:00.000Z')).toMatchObject({
      admitted: true,
      projectActive: 1,
    });
  });

  it('persists policy revisions and active slots across a database restart', () => {
    const { db, policies } = repository();
    const path = db.name;
    policies.set('project', 'project-a', 7, 1, '2026-07-28T11:00:00.000Z');
    policies.tryAcquire('task-a', 'project-a', '2026-07-28T11:01:00.000Z');
    db.close();

    const reopened = openMigratedDatabase(path);
    const recovered = new ConcurrencyPolicyRepository(reopened);
    expect(recovered.getProject('project-a')).toMatchObject({
      maxActiveTasks: 7,
      revision: 2,
    });
    expect(recovered.activeTaskIds()).toEqual(['task-a']);
    expect(recovered.tryAcquire('task-a', 'project-a', '2026-07-28T11:02:00.000Z')).toMatchObject({
      admitted: true,
      reused: true,
    });
    reopened.close();
  });
});
