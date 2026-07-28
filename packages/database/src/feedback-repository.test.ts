import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openMigratedDatabase } from './client.js';
import { FeedbackRepository } from './repositories/feedback-repository.js';

const directories: string[] = [];
afterEach(() => {
  while (directories.length > 0) {
    rmSync(directories.pop()!, { recursive: true, force: true });
  }
});

describe('FeedbackRepository', () => {
  it('persists routed feedback and enforces task-scoped idempotency', () => {
    const directory = mkdtempSync(join(tmpdir(), 'roleflock-feedback-'));
    directories.push(directory);
    const db = openMigratedDatabase(join(directory, 'test.db'));
    const repository = new FeedbackRepository(db);
    const item = {
      id: 'feedback_1',
      taskId: 'task_1',
      sourceActorId: 'user_1',
      text: 'Perbaiki warna tombol.',
      classification: 'interactive_cosmetic_change' as const,
      status: 'routed' as const,
      routedRole: 'planner' as const,
      idempotencyKey: 'feedback-key-1',
      requestHash: 'a'.repeat(64),
      createdAt: '2026-07-28T10:00:00.000Z',
      updatedAt: '2026-07-28T10:00:00.000Z',
    };

    repository.create(item);
    expect(repository.list('task_1')).toEqual([item]);
    expect(repository.getByIdempotencyKey('task_1', 'feedback-key-1')).toEqual(item);
    expect(() => repository.create({ ...item, id: 'feedback_2' })).toThrow(/UNIQUE/);
  });
});
