import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openMigratedDatabase } from './client.js';
import { LeaseRepository } from './repositories/lease-repository.js';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('LeaseRepository', () => {
  it('reclaims a released lease on the same resource', () => {
    // The UNIQUE(resource_type, resource_id) key survives a soft release. A
    // second acquire used to throw even though nobody held the resource — that
    // is what "Writer lease unavailable (durable)" was on a retry.
    const dir = mkdtempSync(join(tmpdir(), 'rf-lease-'));
    dirs.push(dir);
    const db = openMigratedDatabase(join(dir, 'test.db'));
    const leases = new LeaseRepository(db);

    const first = leases.tryAcquire({
      id: 'lease-1',
      resourceType: 'writer',
      resourceId: '/tmp/worktree-a',
      ownerId: 'writer-1',
      acquiredAt: '2026-01-01T00:00:00.000Z',
    });
    expect(first.id).toBe('lease-1');
    leases.release(first.id, '2026-01-01T00:01:00.000Z');

    const second = leases.tryAcquire({
      id: 'lease-2',
      resourceType: 'writer',
      resourceId: '/tmp/worktree-a',
      ownerId: 'writer-2',
      acquiredAt: '2026-01-01T00:02:00.000Z',
    });
    expect(second.id).toBe('lease-2');
    expect(leases.getActive('writer', '/tmp/worktree-a')?.ownerId).toBe('writer-2');
  });

  it('still refuses a second holder while the lease is active', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rf-lease-'));
    dirs.push(dir);
    const db = openMigratedDatabase(join(dir, 'test.db'));
    const leases = new LeaseRepository(db);

    leases.tryAcquire({
      id: 'lease-1',
      resourceType: 'writer',
      resourceId: '/tmp/worktree-b',
      ownerId: 'writer-1',
      acquiredAt: '2026-01-01T00:00:00.000Z',
    });
    expect(() =>
      leases.tryAcquire({
        id: 'lease-2',
        resourceType: 'writer',
        resourceId: '/tmp/worktree-b',
        ownerId: 'writer-2',
        acquiredAt: '2026-01-01T00:01:00.000Z',
      }),
    ).toThrow(/already held/);
  });
});
