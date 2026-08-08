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

  it('persists the selected driver, session, resume parent, and interruption result', () => {
    const invocations = repository();
    invocations.create(record('inv_1'));
    invocations.updateDriver('inv_1', {
      providerConnectionId: 'opencode',
      configuredModelId: 'test-model',
      driverId: 'opencode',
      cancellationCapability: 'local-process',
      resumedFromInvocationId: 'inv_parent',
    });
    invocations.recordDriverSession('inv_1', 'session_41');
    invocations.recordInterruption('inv_1', {
      stopped: false,
      capability: 'local-process',
    });

    expect(invocations.get('inv_1')).toMatchObject({
      providerConnectionId: 'opencode',
      configuredModelId: 'test-model',
      driverId: 'opencode',
      driverSessionId: 'session_41',
      resumedFromInvocationId: 'inv_parent',
      cancellationCapability: 'local-process',
      interruptionJson: JSON.stringify({ stopped: false, capability: 'local-process' }),
    });
  });

  it('resumes only from a known earlier session of the same task, node, and driver', () => {
    const directory = mkdtempSync(join(tmpdir(), 'roflock-inv-session-'));
    directories.push(directory);
    const db = openMigratedDatabase(join(directory, 'test.db'));
    const invocations = new InvocationRepository(db);
    db.prepare(
      `INSERT INTO graph_runs (id, task_id, graph_version_id, state, created_at)
       VALUES ('run_1', 'task_1', 'bug_fix@3', 'running', '2026-08-08T00:00:00.000Z')`,
    ).run();
    for (const id of ['node_known', 'node_unknown', 'node_current']) {
      db.prepare(
        `INSERT INTO node_runs (id, graph_run_id, node_key, state, started_at, created_at)
         VALUES (?, 'run_1', 'writer', 'completed', '2026-08-08T00:00:00.000Z', '2026-08-08T00:00:00.000Z')`,
      ).run(id);
    }
    invocations.create(
      record('inv_known', {
        nodeRunId: 'node_known',
        status: 'completed',
        outcome: 'success',
        startedAt: '2026-08-08T00:00:01.000Z',
        idempotencyKey: 'known-key',
        driverId: 'opencode',
        driverSessionId: 'session_known',
      }),
    );
    invocations.create(
      record('inv_unknown', {
        nodeRunId: 'node_unknown',
        status: 'failed',
        outcome: 'OUTCOME_UNKNOWN',
        startedAt: '2026-08-08T00:00:02.000Z',
        idempotencyKey: 'unknown-key',
        driverId: 'opencode',
        driverSessionId: 'session_unknown',
      }),
    );
    invocations.create(
      record('inv_current', {
        nodeRunId: 'node_current',
        idempotencyKey: 'current-key',
        driverId: 'opencode',
      }),
    );

    expect(
      invocations.findLatestResumableSession({
        taskId: 'task_1',
        nodeKey: 'writer',
        driverId: 'opencode',
        providerConnectionId: 'codex',
        configuredModelId: 'gpt-5.6-sol',
        excludeInvocationId: 'inv_current',
      }),
    ).toMatchObject({ id: 'inv_known', driverSessionId: 'session_known' });
  });
});
