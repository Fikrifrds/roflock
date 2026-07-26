import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, afterEach } from 'vitest';
import { createId, SystemClock } from '@roleflock/contracts';
import { openMigratedDatabase } from './client.js';
import { EventStore } from './repositories/event-store.js';
import { TaskProjector } from './reducers/task-reducer.js';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'roleflock-db-'));
  dirs.push(dir);
  return openMigratedDatabase(join(dir, 'test.db'));
}

describe('event store', () => {
  it('appends events with optimistic sequencing', () => {
    const db = tempDb();
    const store = new EventStore(db);
    const clock = new SystemClock();
    const event = {
      id: createId('evt'),
      aggregateType: 'task',
      aggregateId: 'task_1',
      sequence: 1,
      eventType: 'task.created',
      payload: { id: 'task_1' },
      metadata: { schemaVersion: 1 },
      createdAt: clock.nowIso(),
    };
    store.append(event);
    expect(store.getLastSequence('task_1')).toBe(1);
    expect(() => store.append({ ...event, id: createId('evt'), sequence: 1 })).toThrow(
      /Optimistic sequence/,
    );
  });

  it('is idempotent by key', () => {
    const db = tempDb();
    const store = new EventStore(db);
    const clock = new SystemClock();
    const first = store.append({
      id: createId('evt'),
      aggregateType: 'task',
      aggregateId: 'task_2',
      sequence: 1,
      eventType: 'task.created',
      payload: { id: 'task_2' },
      metadata: { schemaVersion: 1, idempotencyKey: 'create:task_2' },
      createdAt: clock.nowIso(),
    });
    const second = store.append({
      id: createId('evt'),
      aggregateType: 'task',
      aggregateId: 'task_2',
      sequence: 1,
      eventType: 'task.created',
      payload: { id: 'task_2' },
      metadata: { schemaVersion: 1, idempotencyKey: 'create:task_2' },
      createdAt: clock.nowIso(),
    });
    expect(second.id).toBe(first.id);
    expect(store.list('task_2')).toHaveLength(1);
  });

  it('forbids update and delete', () => {
    const db = tempDb();
    const store = new EventStore(db);
    expect(() => store.update()).toThrow(/append-only/);
    expect(() => store.delete()).toThrow(/append-only/);
  });
});

describe('task projector', () => {
  it('replays events to the same projection', () => {
    const db = tempDb();
    const projector = new TaskProjector(db);
    const clock = new SystemClock();
    const taskId = createId('task');
    const created = {
      id: createId('evt'),
      aggregateType: 'task',
      aggregateId: taskId,
      sequence: 1,
      eventType: 'task.created',
      payload: {
        id: taskId,
        projectId: 'proj_1',
        type: 'bug_fix',
        title: 'Fix',
        brief: 'Brief',
        risk: 'medium',
        state: 'draft',
        workflowGraphVersionId: 'g1',
        budgetPolicyId: 'b1',
        maxAttempts: 3,
        createdAt: clock.nowIso(),
        updatedAt: clock.nowIso(),
      },
      metadata: { schemaVersion: 1 },
      createdAt: clock.nowIso(),
    };
    projector.apply(created as never);
    projector.apply({
      id: createId('evt'),
      aggregateType: 'task',
      aggregateId: taskId,
      sequence: 2,
      eventType: 'task.state_changed',
      payload: { state: 'ready' },
      metadata: { schemaVersion: 1 },
      createdAt: clock.nowIso(),
    });
    const loaded = projector.load(taskId);
    expect(loaded?.task.state).toBe('ready');
    expect(loaded?.version).toBe(2);
  });

  it('rejects invalid transitions', () => {
    const db = tempDb();
    const projector = new TaskProjector(db);
    const clock = new SystemClock();
    const taskId = createId('task');
    projector.apply({
      id: createId('evt'),
      aggregateType: 'task',
      aggregateId: taskId,
      sequence: 1,
      eventType: 'task.created',
      payload: {
        id: taskId,
        projectId: 'proj_1',
        type: 'bug_fix',
        title: 'Fix',
        brief: 'Brief',
        risk: 'medium',
        state: 'accepted',
        workflowGraphVersionId: 'g1',
        budgetPolicyId: 'b1',
        maxAttempts: 3,
        createdAt: clock.nowIso(),
        updatedAt: clock.nowIso(),
      },
      metadata: { schemaVersion: 1 },
      createdAt: clock.nowIso(),
    } as never);
    expect(() =>
      projector.apply({
        id: createId('evt'),
        aggregateType: 'task',
        aggregateId: taskId,
        sequence: 2,
        eventType: 'task.state_changed',
        payload: { state: 'running' },
        metadata: { schemaVersion: 1 },
        createdAt: clock.nowIso(),
      }),
    ).toThrow(/Invalid task transition/);
  });
});
