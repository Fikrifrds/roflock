import type { EventEnvelope, Task, TaskState } from '@roleflock/contracts';
import { EventStore } from '../repositories/event-store.js';
import { SnapshotRepository } from '../repositories/snapshot-repository.js';
import type { SqliteDb } from '../client.js';

export interface TaskProjection {
  task: Task;
  version: number;
}

const SNAPSHOT_EVERY = 50;

export function reduceTask(
  current: TaskProjection | undefined,
  event: EventEnvelope,
): TaskProjection {
  switch (event.eventType) {
    case 'task.created': {
      const task = event.payload as unknown as Task;
      return { task, version: event.sequence };
    }
    case 'task.state_changed': {
      if (!current) throw new Error('Cannot change state of missing task');
      const nextState = event.payload.state as TaskState;
      assertTaskTransition(current.task.state, nextState);
      return {
        version: event.sequence,
        task: {
          ...current.task,
          state: nextState,
          updatedAt: event.createdAt,
        },
      };
    }
    default:
      if (!current) {
        throw new Error(`Unknown event ${event.eventType} with no existing projection`);
      }
      return { ...current, version: event.sequence };
  }
}

const ALLOWED_TRANSITIONS: Record<TaskState, TaskState[]> = {
  draft: ['ready', 'cancelled'],
  ready: ['running', 'cancelled'],
  running: [
    'awaiting_confirmation',
    'paused',
    'stopping',
    'failed',
    'awaiting_acceptance',
    'cancelled',
  ],
  awaiting_confirmation: ['running', 'paused', 'cancelled', 'failed'],
  paused: ['running', 'cancelled', 'stopping'],
  stopping: ['cancelled', 'failed', 'paused'],
  failed: ['ready', 'cancelled'],
  awaiting_acceptance: ['accepted', 'rejected', 'running'],
  accepted: [],
  rejected: ['ready', 'cancelled'],
  cancelled: [],
};

export function assertTaskTransition(from: TaskState, to: TaskState): void {
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid task transition ${from} → ${to}`);
  }
}

export class TaskProjector {
  private readonly events: EventStore;
  private readonly snapshots: SnapshotRepository;

  constructor(db: SqliteDb) {
    this.events = new EventStore(db);
    this.snapshots = new SnapshotRepository(db);
  }

  load(taskId: string): TaskProjection | undefined {
    const snapshot = this.snapshots.get(taskId);
    let projection: TaskProjection | undefined = snapshot
      ? {
          task: snapshot.state as unknown as Task,
          version: snapshot.lastSequence,
        }
      : undefined;

    const remaining = this.events.list(taskId, projection?.version ?? 0);
    for (const event of remaining) {
      projection = reduceTask(projection, event);
    }
    return projection;
  }

  apply(event: EventEnvelope): TaskProjection {
    const current = this.load(event.aggregateId);
    const next = reduceTask(current, event);
    this.events.append(event);
    if (next.version % SNAPSHOT_EVERY === 0 || isTerminal(next.task.state)) {
      this.snapshots.save({
        aggregateId: event.aggregateId,
        aggregateType: 'task',
        lastSequence: next.version,
        state: next.task as unknown as Record<string, unknown>,
        createdAt: event.createdAt,
      });
    }
    return next;
  }
}

function isTerminal(state: TaskState): boolean {
  return state === 'accepted' || state === 'cancelled' || state === 'rejected';
}
