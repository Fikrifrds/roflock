import { afterEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type SqliteDb } from './client.js';
import { AdaptiveRoutingControlRepository } from './repositories/adaptive-routing-control-repository.js';

let db: SqliteDb | undefined;
afterEach(() => db?.close());

describe('adaptive routing controls', () => {
  it('keeps immutable history while resolving the latest user control', () => {
    db = openDatabase({ path: ':memory:' });
    migrate(db);
    const repository = new AdaptiveRoutingControlRepository(db);
    repository.create({
      id: 'control_1',
      targetType: 'observation',
      targetId: 'observation_1',
      action: 'exclude',
      reason: 'Known anomalous infrastructure failure',
      actorId: 'actor_1',
      createdAt: '2026-07-28T12:00:00.000Z',
    });
    repository.create({
      id: 'control_2',
      targetType: 'observation',
      targetId: 'observation_1',
      action: 'include',
      reason: 'Investigation found the sample valid',
      actorId: 'actor_1',
      createdAt: '2026-07-28T13:00:00.000Z',
    });
    expect(repository.effective('observation', 'observation_1')).toMatchObject({
      id: 'control_2',
      action: 'include',
    });
    expect(repository.history('observation', 'observation_1')).toHaveLength(2);
    expect(() =>
      db!.prepare(`UPDATE adaptive_routing_controls SET reason = 'rewritten'`).run(),
    ).toThrow(/immutable/);
  });
});
