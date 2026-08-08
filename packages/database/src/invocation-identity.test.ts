import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stableInvocationKey } from '@roleflock/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { openMigratedDatabase } from './client.js';
import { InvocationRepository } from './repositories/invocation-repository.js';

const directories: string[] = [];

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true });
});

function repository() {
  const directory = mkdtempSync(join(tmpdir(), 'roflock-inv-'));
  directories.push(directory);
  return new InvocationRepository(openMigratedDatabase(join(directory, 'test.db')));
}

const key = stableInvocationKey({
  taskId: 'task_1',
  graphVersionId: 'bug_fix@3',
  nodeId: 'writer',
  attempt: 1,
  loopIteration: 0,
});

function record(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    nodeRunId: 'node_run_1',
    providerConnectionId: 'codex',
    configuredModelId: 'gpt-5.6-sol',
    status: 'running',
    startedAt: new Date().toISOString(),
    idempotencyKey: key,
    ...overrides,
  };
}

describe('invocation identity storage', () => {
  it('finds a turn that was already recorded', () => {
    const invocations = repository();
    invocations.create(record('inv_1'));

    expect(invocations.findByIdempotencyKey(key)?.id).toBe('inv_1');
  });

  it('returns nothing for a turn that never started', () => {
    expect(repository().findByIdempotencyKey(key)).toBeUndefined();
  });

  it('refuses a second row for the same turn', () => {
    const invocations = repository();
    invocations.create(record('inv_1'));

    // The database is the last line of defence: even a caller that skipped the
    // lookup cannot record the same billable turn twice.
    expect(() => invocations.create(record('inv_2'))).toThrow();
  });

  it('still returns a turn whose outcome is unknown', () => {
    const invocations = repository();
    invocations.create(record('inv_1', { status: 'unknown', outcome: 'OUTCOME_UNKNOWN' }));

    // Unknown is not permission to repeat (ADR-010) — the caller must see it
    // and stop, rather than find nothing and spend again.
    expect(invocations.findByIdempotencyKey(key)?.outcome).toBe('OUTCOME_UNKNOWN');
  });

  it('lets rows without an identity coexist', () => {
    const invocations = repository();
    const legacy = { idempotencyKey: undefined };
    invocations.create(record('inv_1', legacy));

    // Rows predating the column are all NULL and must not collide with
    // each other.
    expect(() => invocations.create(record('inv_2', legacy))).not.toThrow();
  });
});
