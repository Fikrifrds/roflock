import { afterEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, type SqliteDb } from './client.js';
import { RoleAssignmentRepository } from './repositories/role-assignment-repository.js';

let db: SqliteDb | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
});

describe('task-pinned role assignments', () => {
  it('keeps a recommendation roster isolated from later global roster changes', () => {
    db = openDatabase({ path: ':memory:' });
    migrate(db);
    const assignments = new RoleAssignmentRepository(db);
    assignments.replaceRole(
      'writer',
      [{ providerConnectionId: 'codex', modelId: 'global-v1', effort: 'medium' }],
      at,
    );
    assignments.replaceTaskRole(
      'task_1',
      'writer',
      [
        { providerConnectionId: 'codex', modelId: 'pinned-primary', effort: 'high' },
        { providerConnectionId: 'codex', modelId: 'pinned-fallback', effort: 'medium' },
      ],
      {
        recommendationId: 'recommendation_1',
        recommendationActionId: 'action_1',
      },
      at,
    );
    assignments.replaceRole(
      'writer',
      [{ providerConnectionId: 'claude', modelId: 'global-v2', effort: 'high' }],
      later,
    );

    expect(assignments.listForRole('writer').map((candidate) => candidate.modelId)).toEqual([
      'global-v2',
    ]);
    expect(assignments.listForTaskRole('task_1', 'writer')).toMatchObject([
      {
        position: 0,
        modelId: 'pinned-primary',
        recommendationId: 'recommendation_1',
        recommendationActionId: 'action_1',
      },
      {
        position: 1,
        modelId: 'pinned-fallback',
        recommendationId: 'recommendation_1',
        recommendationActionId: 'action_1',
      },
    ]);
    expect(assignments.listForTaskRole('task_2', 'writer')).toEqual([]);
  });
});

const at = '2026-07-28T12:00:00.000Z';
const later = '2026-07-28T13:00:00.000Z';
